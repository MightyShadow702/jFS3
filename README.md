# jFS3
**A pure-JS, content-addressed, copy-on-write virtual filesystem for the browser — featuring deduplication, filesystem universes, events, and optional asynchronous sync.**

jFS3 is a modern, lightweight filesystem engine designed for browser environments and offline-first applications.  
It stores file data as immutable, hashed blocks in IndexedDB, maintains inodes in LocalStorage, and provides advanced features such as Copy-on-Write, snapshots, universes, block-level deduplication, and an event-driven architecture — all in ~10 kB minified and with zero dependencies.

---

## ✨ Features

### 🔹 Content-addressed storage (SHA-256)
All file data is chunked, hashed, and stored by content.

### 🔹 Copy-on-Write (CoW)
All modifications create new blocks while preserving old ones.

### 🔹 Atomic block-level deduplication
Identical blocks across all files, directories, universes are stored only once.

### 🔹 Filesystem Universes (advanced snapshots)
Universes are isolated copies of filesystem subtrees.

Example:
```js
fs.transfer("/", "@backup"); // create snapshot
fs.transfer("@backup", "/"); // restore snapshot
```

### 🔹 Full event system
Includes events:
- change-path
- create-file
- change-file
- delete-file
- create-dir
- delete-dir
- read-file
- write-block
- write-inode
- read-inode
- delete-inode
- move
- copy
- transfer
- deleteTransfer

### 🔹 (Optional) async sync protocol
Includes send/receive frame encoding, block transfer, metadata merge, tombstones, and timestamp-based conflict resolution.

### 🔹 Pure JavaScript, no dependencies
Works in browsers, PWAs, WebViews, offline apps, and extensions (~10 kB minified).

---

## 📦 Installation

```html
<script src="jFS3.js"></script>
```

Or:

```js
import jFS3 from "./jFS3.js";
```

---

## 🚀 Quick Start

```js
const fs = new jFS3(8192, false); // (default_blocksize: 8196, sync: false)

// Create directories
fs.mkdir("/docs");

// Write
await fs.writeFile("/docs/hello.txt", "Hello World");

// Read
const file = await fs.readFile("/docs/hello.txt");
console.log(await file.text());

// Create a snapshot
fs.transfer("/", "@u1");

// Delete file
fs.rm("/docs/hello.txt");

// Restore
fs.transfer("@u1", "/");
```

---

## 🧱 Architecture

### Inodes (LocalStorage)
JSON-based inode structures containing type, blocks, timestamps, etc.

### Blocks (IndexedDB)
Immutable, hashed blocks stored under a "blocks" store.

### CoW + Deduplication
When writing data, jFS3 only stores new blocks if the content is unique.
Existing blocks are reused through hash-based deduplication.

### Garbage Collection
Runs every 30 seconds to delete unreferenced blocks.

### Universes
Used for snapshots and restore operations.

### Sync Protocol
Uses base64-encoded JSON frames for block + inode replication.

---

## 🧪 API Overview

### Directories
- fs.mkdir(path)
- fs.rmdir(path)
- fs.listdir(path)
- fs.chdir(path)
- fs.getcwd()

### Files
- fs.writeFile(path, data, blocksize?)
- fs.readFile(path)
- fs.rm(path)

### Files & Directories
- fs.copy(src, dest)
- fs.move(src, dest)

### Paths
- fs.abspath(path)
- fs.relpath(path, target?)
- fs.join(root, path)
- fs.split(path)
- fs.splitext(path)

### Metadata
- fs.metainfo(path)

### Universes
- fs.transfer(src, dest)
- fs.deleteTransfer(path)

### Events
- fs.on(event, handler)
- fs.off(event, handler)

### Sync
- fs.addTX(sendFunction, interval, frameSize)
- fs.pushRX(frame)

---

## 📌 Use Cases

- Browser file managers (client-side)
- Offline-first editors (text, code, binary)
- WebXDC / DeltaChat apps
- P2P sync
- Versioning + snapshots
- Git-like branching in-browser

---

## 🤝 Contributing

Issues and PRs are welcome!

---

## 📄 License

LGPL-3.0
