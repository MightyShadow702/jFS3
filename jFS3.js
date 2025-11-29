class jFSError extends Error
{
    constructor(code, message)
    {
        super(message);
        this.code = code;
        this.name = "jFSError";
    }
}
class IDB {
    constructor(name = "db", store = "store") {
        this.name = name;
        this.store = store;
        this.db = null;
        this.ready = this._open();
    }
    _prom(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    async _open() {
        const req = indexedDB.open(this.name, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(this.store))
                db.createObjectStore(this.store);
        };
        this.db = await this._prom(req);
    }
    async get(key) {
        await this.ready;
        const tx = this.db.transaction(this.store, "readonly");
        const store = tx.objectStore(this.store);
        const req = store.get(key);
        return await this._prom(req);
    }
    async put(key, value) {
        await this.ready;
        const tx = this.db.transaction(this.store, "readwrite");
        const store = tx.objectStore(this.store);
        const req = store.put(value, key);
        return await this._prom(req);
    }
    async delete(key) {
        await this.ready;
        const tx = this.db.transaction(this.store, "readwrite");
        const store = tx.objectStore(this.store);
        const req = store.delete(key);
        return await this._prom(req);
    }
    async has(key) {
        await this.ready;
        const tx = this.db.transaction(this.store, "readonly");
        const store = tx.objectStore(this.store);
        const req = store.getKey(key);
        const result = await this._prom(req);
        return result !== undefined;
    }
    async keys() {
        await this.ready;
        const tx = this.db.transaction(this.store, "readonly");
        const store = tx.objectStore(this.store);
        const req = store.openKeyCursor();
        const keys = [];
        return new Promise((resolve, reject) => {
            req.onerror = () => reject(req.error);
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) return resolve(keys);
                keys.push(cursor.key);
                cursor.continue();
            };
        });
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
    if (!path.startsWith("/")) path = this.join(this._cwd, path);
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
    var garbage = new Set(await this.blocks.keys());
    this._foreach(this.inodes.values(), (node) => node.blocks,
        (node) => this._foreach(node.blocks, (block) => garbage.has(block),
            (block) => garbage.delete(block)
        )
    );
    for (const block of garbage)
    {
      await this.blocks.delete(block);
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
          this.inodes[dest] = this.inodes[dest];
          delete this.inodes[dest];
        },
        (path, dest) => {
          this.transfer(path, dest);
          this.deleteTransfer(path);
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
  async writeFile(path, content, bs=this._bs)
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
              if (!await this.blocks.has(hash))
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
        while (parts.length > 0)
        {
            const [hash, chunk] = parts.shift();
            if("write-block" in this.eventListeners) this.emit("write-block", {block: hash, chunk});
            await this.blocks.put(hash, chunk);
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
      const parts = [];
      var size = 0;
      for (const block of file.blocks)
      {
          if (!await this.blocks.has(block)) throw new jFSError("EIO", "Missing block:" + block);
          const chunk = await this.blocks.get(block);
          parts.push(chunk);
          size += chunk.length;
      }
      const res = new Uint8Array(size);
      var offset = 0;
      for (const p of parts)
      {
          res.set(p, offset);
          offset += p.length;
      }
      const name = this.split(path)[1];
      return new File([res], name, {
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
  deleteTransfer(path)
  {
      this._foreach([...this.inodes.keys()], (ident) => (ident === path || ident.startsWith(path === "/" ? "/" : path+"/")),
         (ident) => {
            delete this.inodes[ident];
          }
      );
      if ("transfer" in this.eventListeners) this.emit("delete-transfer", path);
  }
  transfer(src, dest)
  {
    const garbage = new Set();
    if (!(src in this.inodes)) throw new jFSError("ENOENT", "Source universe not found");
    this._foreach([...this.inodes.keys()], (ident) => (ident === dest || ident.startsWith(dest === "/" ? "/" : dest+"/")),
        (ident) => garbage.add(ident)
    );
    this._foreach(Object.entries({...this.inodes}), (ident, _) => (ident === src || ident.startsWith(src === "/" ? "/" : src+"/")),
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
    if ("transfer" in this.eventListeners) this.emit("create-transfer", src, dest);
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
      if (!frame_size) frame_size = 138000;
      if (!interval) interval=10000;
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
          if (event.block && !await this.blocks.has(event.block)) await this.blocks.put(event.block, event.chunk);
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
  constructor(bs=512, sync=true)
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
    this.inodes = new Proxy(JSON.parse(localStorage.getItem("jFS3inodes") || "{}"), {
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
        if (key != "/")
        {
          if ("write-inode" in self.eventListeners) self.emit("write-inode", {path: key, ...value});
          localStorage.setItem("jFS3inodes", JSON.stringify(target));
        }
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
          localStorage.setItem("jFS3inodes", JSON.stringify(target));
        }
        return true;
      }
    });
    if (!this.isdir("/")) this.inodes["/"] = {type: "dir", ctime: 0, mtime: 0};
    this._cwd = "/";
    this.blocks = new IDB("jFS3blocks", "blocks");
    this.deduplicate();
    setInterval(() => this.deduplicate(), 30000);
  }
}
