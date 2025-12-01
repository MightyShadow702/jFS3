class jFSError extends Error
{
  constructor(code, message)
  {
    super(message);
    this.code = code;
    this.name = "jFSError";
  }
}
class IDB
{
  constructor(name="db", ...stores) {
    this.name = name;
    this.stores = stores;
    this.db = null;
    this.ready = this._open();
  }
  _prom(req)
  {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async _open()
  {
    const req = indexedDB.open(this.name, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const store of this.stores)
      {
        if (!db.objectStoreNames.contains(store))
          db.createObjectStore(store);
      }
    };
    this.db = await this._prom(req);
    this._keys = {};
    for (const src of this.stores)
    {
      const tx = this.db.transaction(src, "readonly");
      const os = tx.objectStore(src);
      const req = os.openKeyCursor();
      const set = new Set();
      await new Promise((resolve, reject) => {
        req.onerror = () => reject(req.error);
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return resolve();
          set.add(cursor.key);
          cursor.continue();
        };
      });
      this._keys[src] = set;
    }
  }
  async getMissing(src, ...keys)
  {
    await this.ready;
    const set = this._keys[src];
    return Promise.resolve(keys.filter(k => !set.has(k)));
  }
  async *get(src, ...keys)
  {
    await this.ready;
    const tx = this.db.transaction(src, "readonly");
    const os = tx.objectStore(src);
    for (const key of keys)
      yield await this._prom(os.get(key));
  }
  async put(src, ...entries)
  {
    await this.ready;
    const tx = this.db.transaction(src, "readwrite");
    const os = tx.objectStore(src);
    for (const [key, value] of entries)
    {
      await this._prom(os.put(value, key));
      this._keys[src].add(key);
    }
  }
  async delete(src, ...keys)
  {
    await this.ready;
    const tx = this.db.transaction(src, "readwrite");
    const os = tx.objectStore(src);
    for (const key of keys)
    {
      await this._prom(os.delete(key));
      this._keys[src].delete(key);
    }
  }
  has(src, key)
  {
    return this._keys[src].has(key);
  }
  keys(src)
  {
    return [...this._keys[src]];
  }
  async *entries(src)
  {
    await this.ready;
    var keys = [...this._keys[src]];
    while (keys.length > 0)
    {
      var index = 0;
      for await (const value of this.get(src, ...keys.slice(0, 1000)))
      {
        yield [keys[index++], value];
      }
      keys = keys.slice(1000);
    }
  }
  async onready(fn)
  {
    await this.ready;
    await fn();
  }
}
class jFS3
{
  async _hash(bytes)
  {
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    const hashArray = new Uint8Array(hashBuffer);
    var hex = "";
    for (const b of hashArray) {
      hex += b.toString(16).padStart(2, "0");
    }
    return hex;
  }
  normalize(path)
  {
    var rpath = [];
    for (var part of path.split("/"))
    {
      if (part == ".") continue;
      if (part == ".." && rpath.length > 0)
      {
        rpath.pop();
        continue
      }
      if (part.length > 0) rpath.push(part);
    }
    var npath = rpath.join("/");
    if (path.startsWith("/")) npath = "/" + npath;
    if (npath.endsWith("/") && npath.length > 1) npath = npath.slice(0, npath.length - 1);
    return npath;
  }
  join(root, path)
  {
    return this.normalize(root + "/" + path);
  }
  relpath(path, target=this._cwd)
  {
    var path = this.abspath(path);
    var target = this.abspath(target);
    const p = path === "/" ? [] : path.split("/").slice(1);
    const t = target === "/" ? [] : target.split("/").slice(1);
    var i = 0;
    while (i < p.length && i < t.length && p[i] === t[i]) i++;
    return [...Array(t.length - i).fill(".."), ...p.slice(i, p.length)].join("/") || ".";
  }
  abspath(path)
  {
    if (!path || !path.startsWith("/")) path = this.join(this._cwd, path);
    return this.normalize(path);
  }
  split(path)
  {
    path = this.normalize(path);
    const spath = path.split("/");
    const dir = spath.slice(0, spath.length - 1).join("/");
    const file = spath[spath.length - 1];
    return [dir === "" && path.startsWith("/") ? "/" : dir, file];
  }
  splitext(path)
  {
    const spath = path.split(".");
    if (spath.length == 0) return ["", ""];
    const name = spath.length > 1 ? spath.slice(0, spath.length-1).join(".") : spath[0];
    const ext = spath.length > 1 ? "."+spath[spath.length-1] : "";
    return [name, ext];
  }
  isfile(path)
  {
    path = this.abspath(path);
    return path in this.inodes && this.inodes[path].type == "file";
  }
  isdir(path)
  {
    path = this.abspath(path);
    return path in this.inodes && this.inodes[path].type == "dir";
  }
  mkdir(path)
  {
    path = this.abspath(path);
    const [root, name] = this.split(path);
    if (!this.isdir(root)) throw new jFSError("ENOENT", "Parent directory not found: " + root);
    if (this.isfile(path)) throw new jFSError("EEXIST", "File exists: " + name);
    const mdate = Date.now();
    const node = {
      ...this.inodes[path],
      type: "dir",
      mdate
    }
    node.cdate = node.cdate || mdate;
    this.inodes[path] = node;
    if ("create-dir" in this.eventListeners) this.emit("create-dir", {path, ...node});
  }
  _foreach(src, bool, func)
  {
    for (const args of src)
    {
      if (bool.length > 1)
      {
        if (bool(...args)) func(...args);
      }
      else
      {
        if (bool(args)) func(args);
      }
    }
  }
  foreach(path, bool, func)
  {
      path = this.abspath(path);
      if (!this.isdir(path)) return;
      this._foreach([...this.inodes.keys()], bool, func);
  }
  _rmcontent(path)
  {
     this.foreach(path, (ident) => ident.startsWith(path+"/"),
      (file) => {
        if (this.isfile(file)) this.rm(file);
        else if (this.isdir(file)) this.rmdir(file);
       }
     );
  }
  rmdir(path)
  {
    path = this.abspath(path);
    if(this.isfile(path)) throw new jFSError("ENODIR", "Not a directory: " + path);
    if (!this.isdir(path)) throw new jFSError("ENOENT", "Directory not found: " + path);
    this._rmcontent(path);
    delete this.inodes[path];
    if ("delete-dir" in this.eventListeners) this.emit("delete-dir", path);
  }
  chdir(path)
  {
    path = this.abspath(path);
    if(this.isfile(path)) throw new jFSError("ENODIR", "Not a directory: " + path);
    if (!this.isdir(path)) throw new jFSError("ENOENT", "Directory not found: " + path);
    this._cwd = path;
    if ("change-path" in this.eventListeners) this.emit("change-path", path);
  }
  getcwd()
  {
    return this._cwd;
  }
  listdir(path=this._cwd)
  {
    const index = [];
    path = this.abspath(path);
    if(this.isfile(path)) throw new jFSError("ENODIR", "Not a directory: " + path);
    if (!this.isdir(path)) throw new jFSError("ENOENT", "Directory not found: " + path);
    for (const ident of Object.keys(this.inodes))
    {
      const [root, name] = this.split(ident);
      if (root == path && name.length > 0) index.push(name);
    }
    return index;
  }
  async deduplicate()
  {
    if (this._gc_lock) return;
    var garbage = new Set(this.backend.keys("blocks"));
    this._foreach(this.inodes.values(), (node) => node.blocks,
      (node) => this._foreach(node.blocks, (block) => garbage.has(block),
        (block) => garbage.delete(block)
      )
    );
    garbage = [...garbage];
    while (garbage.length > 0)
    {
      await this.backend.delete("blocks", ...garbage.slice(0, 1000));
      garbage = garbage.slice(1000);
    }
  }
  _path_manipulator(src, dest, onfile, ondir)
  {
    src = this.abspath(src);
    dest = this.abspath(dest);
    if (!this.isfile(src) && !this.isdir(src)) throw new jFSError("ENOENT", "File or directory not found: " + src);
    if (dest in this.inodes) throw new jFSError("EEXIST", "Path already exists: " + dest);
    const parent = this.split(dest)[0];
    if (!this.isdir(parent)) throw new jFSError("ENOENT", "Parent directory not found: " + parent);
    if (this.isdir(src)) ondir(src, dest);
    else if (this.isfile(src)) onfile(src, dest);
  }
  rm(path)
  {
    path = this.abspath(path);
    if(this.isdir(path)) throw new jFSError("EISDIR", "Not a file: " + path);
    if (!this.isfile(path)) throw new jFSError("ENOENT", "File not found: " + path);
    delete this.inodes[path];
    if ("delete-file" in this.eventListeners) this.emit("delete-file", path);
  }
  move(src, dest)
  {
      this._path_manipulator(src, dest,
        (path, dest) => {
          this.inodes[dest] = this.inodes[path];
          delete this.inodes[path];
        },
        (path, dest) => {
          this.transfer(path, dest);
          this.deleteTree(path);
        }
      );
      if ("move" in this.eventListeners) this.emit("move", src, dest);
  }
  copy(src, dest)
  {
    this._path_manipulator(src, dest,
      (path, dest) => {
        const mdate = Date.now();
        this.inodes[dest] = {...structuredClone(this.inodes[path]),
          cdate:mdate,
          mdate
        };
      },
      (path, dest) => {
        this.mkdir(dest);
        this.foreach(path, (ident) => ident.startsWith(path+"/"),
          (ident) => {
            const new_ident = this.join(dest, ident.slice(path.length));
            this.copy(ident, new_ident);
          }
        );
      }
    );
    if ("copy" in this.eventListeners) this.emit("copy", src, dest);
  }
  async writeFile(path, content="", bs=this._bs)
  {
    path = this.abspath(path);
    if (this.isdir(path)) throw new jFSError("EISDIR", "Not a file: " + path);
    const [parent, name] = this.split(path);
    if (!this.isdir(parent)) throw new jFSError("ENOENT", "Parent directory not found: " + parent);
    var data = undefined;
    var mime = "application/octet-stream";
    const mdate = Date.now();
    var cdate = mdate;
    if (content instanceof File || content instanceof Blob)
    {
      data = new Uint8Array(await content.arrayBuffer());
      mime = content.type || mime;
      cdate = content.lastModified;
    }
    else if (content instanceof Uint8Array)
    {
      data = content;
    }
    else if (typeof content === "string")
    {
      data = new TextEncoder().encode(content);
      mime = "text/plain";
    }
    if (data)
    {
      const size = data.length;
      const blocks = [];
      const parts = [];
      for (var i = 0; i < data.length; i += bs)
      {
        const chunk = data.slice(i, i + bs);
        const hash = await this._hash(chunk);
        blocks.push(hash);
        if (!this.backend.has("blocks", hash))
        {
          parts.push([hash, chunk]);
        }
      }
    const mdate = Date.now();
    const node = {
      ...this.inodes[path],
      type: "file",
      blocks,
      size,
      mdate
    }
    var event;
    if (node.cdate)
    {
      event = "change-file";
    }
    else
    {
      event = "create-file";
      node.cdate = mdate;
    }
    this.inodes[path] = node;
    await this.backend.put("blocks", ...parts);
    for (const [hash, chunk] of parts)
    {
      if("write-block" in this.eventListeners) this.emit("write-block", {block: hash, chunk});
    }
    if (event in this.eventListeners) this.emit(event, {path, ...node});
    }
  }
  async readFile(path)
  {
    path = this.abspath(path);
    if (this.isdir(path)) throw new jFSError("EISDIR", "Not a file: " + path);
    if (!this.isfile(path)) throw new jFSError("ENOENT", "File not found: " + path);
    const file = this.inodes[path];
    if ("read-file" in this.eventListeners) this.emit("read-file", {path, ...file});
    for (const block of await this.backend.getMissing("blocks", ...file.blocks))
    {
      throw new jFSError("EIO", "Missing block: " + block);
    }
    const name = this.split(path)[1];
    const blocks = [];
    for await (const block of this.backend.get("blocks", ...file.blocks))
      blocks.push(block);
    return new File(blocks, name, {
        type: file.mime,
        lastModified: file.mdate
      });
  }
  metainfo(path)
  {
    path = this.abspath(path);
    if (!this.isfile(path) && !this.isdir(path)) throw new jFSError("ENOENT", "File or directory not found: " + path);
    const entry = {
      path,
      ...this.inodes[path]
    };
    delete entry.blocks;
    return entry;
  }
  deleteTree(path)
  {
    if (path in this.inodes)
    {
      this._foreach([...this.inodes.keys()], (ident) => (ident === path || ident.startsWith(path === "/" ? "/" : path+"/")),
       (ident) => {
         delete this.inodes[ident];
        }
      );
      if ("delete-tree" in this.eventListeners) this.emit("delete-tree", path);
      return true;
    }
  }
  cloneUniverse(src, dest)
  {
    if (src !== "/") src = src.startsWith("@") ? src : "@" + src;
    if (this.listUniverses().has(src))
    {
      if (dest !== "/") dest = dest.startsWith("@") ? dest : "@" + dest;
      const res = this.transfer(src, dest);
      if (res && "create-universe" in this.eventListeners) this.emit("create-universe", dest);
      return res;
    }
  }
  deleteUniverse(name)
  {
    if (name !== "/") name = name.startsWith("@") ? name : "@" + name;
    const res = this.deleteTree(name);
    if (res && "delete-universe" in this.eventListeners) this.emit("delete-universe", name);
    return res;
  }
  transfer(src, dest)
  {
    if (src in this.inodes && dest.includes("/") ? this.split(dest)[0] in this.inodes : dest.startsWith("@"))
    {
      const garbage = new Set();
      if (!(src in this.inodes)) throw new jFSError("ENOENT", "Source universe not found");
      this._foreach([...this.inodes.keys()], (ident) => (ident === dest || ident.startsWith(dest === "/" ? "/" : dest+"/")),
        (ident) => garbage.add(ident)
      );
      this._foreach(Object.entries(this.inodes), (ident, _) => (ident === src || ident.startsWith(src === "/" ? "/" : src+"/")),
        (ident, node) => {
          const new_ident = this.join(dest, ident.slice(src.length));
          this.inodes[new_ident] = structuredClone(node);
          garbage.delete(new_ident);
        }
      );
      for (const node of garbage)
      {
        delete this.inodes[node];
      }
      if ("create-tree" in this.eventListeners) this.emit("create-tree", src, dest);
      return true;
    }
  }
  listUniverses()
  {
    const universes = new Set();
    for (const ident of this.inodes.keys())
    {
      const parent = ident.startsWith("/") ? this.split(ident)[0] : ident;
      if (parent === "/" || parent.startsWith("@") && !parent.includes("/"))
      {
        universes.add(parent);
      }
    }
    return universes;
  }
  async quota(path=null)
  {
    var logicalSize = 0;
    this._foreach(this.inodes.keys(),
      (ident) => path ? ident.startsWith(path === "/" ? path : path+"/") : true,
      (ident) => logicalSize += this.inodes[ident].size || 0
    );
    var refs = 0;
    this._foreach(this.inodes.values(),
      (node) => node.blocks,
      (node) => refs += node.blocks.length
    );
    const unique = this.backend.keys("blocks").length;
    const usage = refs > 0 ? unique/refs : 0;
    return {
      logicalSize,
      estimatedPhysicalSize: Math.round(logicalSize*usage),
      referencedBlocks: refs,
      uniqueBlocks: unique,
      usageRatio: usage,
      dedupRatio: usage > 0 ? 1/usage : 0
    }
  }
  on(event, handler)
  {
    if (typeof handler !== "function") console.error("jFS event-error: incompatible handler");
    if(!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(handler);
    return () => this.off(event, handler);
  }
  off(event, func)
  {
    if (this.eventListeners[event] && this.eventListeners[event].includes(func))
    {
      this.eventListeners[event].remove(func);
    }
  }
  emit(event, ...args)
  {
    if (this.eventListeners[event])
    {
      for (const handle of [...this.eventListeners[event]])
      {
        try {
          handle(...args);
        } catch (e) {
          console.error("jFS event-error for", event, e);
        }
      }
    }
  }
  addTX(func, interval=undefined, frame_size=undefined)
  {
    if (!frame_size) frame_size = 128000;
    if (!interval) interval=500;
    if (this._tx) clearInterval(this._tx);
    this._tx = setInterval(() => {
      const frame = [];
      var size = 0;
      var last;
      while (size + frame.length < frame_size)
      {
        last = this.send_queue.shift();
        if (!last) break;
        const op = btoa(JSON.stringify(last));
        frame.push(op);
        size += op.length;
      }
      if (last)
      {
        this.send_queue.unshift(last);
      }
      if (frame.length > 0)
      {
        func(frame.join("|"));
      }
    }, interval);
  }
  async pushRX(frame)
  {
    for (const rx of frame.split("|"))
    {
      if (!rx) continue;
      const event = JSON.parse(atob(rx));
      if (event.block && !this.backend.has("blocks", event.block))
        await this.backend.put("blocks", [event.block, event.chunk]);
      else if (event.path)
      {
        const path = event.path;
        delete event.path;
        if (event.type == "dir" || event.type == "file")
        {
          if (!this.inodes[path] || this.inodes[path] && event.mdate > this.inodes[path].mdate)
          {
            this.inodes[path] = event;
          }
        }
        else if (event.type === "tombstone")
        {
          if(path in this.inodes)
          {
            if (this.isdir(path)) this._rmcontent(path);
            delete this.inodes[path];
          }
        }
      }
    }
  }
  onready(fn)
  {
    if (this._ready) fn();
    else
    {
      this.on("ready", () => {
        this._ready = true;
        fn();
      });
    }
  }
  constructor(bs=4096, sync=false)
  {
    this._bs = bs;
    const self = this;
    this.eventListeners = {};
    if (sync)
    {
      this.send_queue = [];
      this.on("write-inode", (e) => this.send_queue.push(e));
      this.on("delete-inode", (e) => this.send_queue.push(e));
      this.on("write-block", (e) => this.send_queue.push(e));
    }
    this.backend = new IDB("jFS3backend", "blocks", "inodes");
    this.on("write-inode", async (e) => {
        const {path, ...value} = e;
        await this.backend.put("inodes", [path, {...value}]);
    });
    this.on("delete-inode", async (e) => {
        await this.backend.delete("inodes", e.path);
    });
    this.backend.onready(async () => {
      this.inodes = new Proxy(Object.fromEntries(await Array.fromAsync(this.backend.entries("inodes"))), {
        get(target, key)
        {
            if (key == "keys")
            {
                return () => Object.keys(target);
            }
            else if (key == "values")
            {
                return () => Object.values(target);
            }
            if ("read-inode" in self.eventListeners) self.emit("read-inode", {path:key, ...target[key]});
            return target[key];
        },
        set(target, key, value)
        {
            target[key] = value;
            if (key !== "/" && "write-inode" in self.eventListeners) self.emit("write-inode", {path: key, ...value});
            return true;
        },
        has(target, key)
        {
            return key in target;
        },
        deleteProperty(target, key)
        {
            if (key != "/")
            {
                delete target[key];
                const ctime = Date.now();
                if ("delete-inode" in self.eventListeners) self.emit("delete-inode", {path: key, type: "tombstone", ctime, mtime: ctime});
            }
            return true;
        }
      });
      if (!this.isdir("/")) this.inodes["/"] = {type: "dir", ctime: 0, mtime: 0};
      this._cwd = "/";
      this.deduplicate();
      setInterval(() => this.deduplicate(), 60000);
      this.emit("ready");
    });
  }
}
