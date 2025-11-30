# jFS3
![License: LGPL v3](https://img.shields.io/badge/License-LGPLv3-blue.svg)
![Size](https://img.shields.io/badge/size-~10kB-brightgreen)
![Language: JavaScript](https://img.shields.io/badge/language-JavaScript-yellow)
![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)
![Platform](https://img.shields.io/badge/platform-browser-blue)
![CoW](https://img.shields.io/badge/Copy--on--Write-yes-blue)
![SHA256](https://img.shields.io/badge/Content--addressed-SHA--256-blue)
![Deduplication](https://img.shields.io/badge/block--dedup-yes-green)
![Deduplication](https://img.shields.io/badge/status-WIP-green)

**A pure-JS, content-addressed, copy-on-write virtual filesystem for the browser, featuring: deduplication, filesystem universes (snapshots), events, and optional asynchronous sync.**

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
fs.cloneUniverse("/", "@backup"); // create snapshot
fs.cloneUniverse("@backup", "/"); // restore snapshot
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
- create-tree
- delete-tree
- create-universe
- delete-universe

### 🔹 (Optional) async sync protocol
Includes send/receive frame encoding, block transfer, metadata merge, tombstones, and timestamp-based conflict resolution.

Example (with [WebXDC](https://webxdc.org)):
```js
const fs = new jFS3(2048, true) // blocksize: 2048, sync: true
// add send (TX)
fs.addTX(
  // called on given interval (when payload aviable)
  (frame) => {
    window.webxdc.sendUpdate({payload:frame})
  },
  // set interval (default: 10s)
  window.webxdc.sendUpdateInterval || 10000,
  // set max-frame-size (default: 128kB)
  window.webxdc.sendUpdateMaxSize || 128000
)

// connect receive (RX)
window.webxdc.setUpdateListener((update) => fs.pushRX(update.payload));
```

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
const fs = new jFS3(4096); // Use blocksize: 4096 bytes

// Run when Filesystem is ready
fs.onready(async () => {

  // Create directories
  fs.mkdir("/docs");

  // Write
  await fs.writeFile("/docs/hello.txt", "Hello World");

  // Read
  const file = await fs.readFile("/docs/hello.txt");
  console.log(await file.text());

  // Create a snapshot
  fs.cloneUniverse("/", "@u1");

  // Delete file
  fs.rm("/docs/hello.txt");

  // Restore snapshot to revive deleted file
  fs.cloneUniverse("@u1", "/");

});
```

---
## 📗 Examples
- [SimpleExplorer](Example/SimpleExplorer.html) ([Demo](https://rawcdn.githack.com/MS702/jFS3/refs/heads/main/Example/SimpleExplorer.html))

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
jFS3 is built around the concept of filesystem universes.

The root universe "/" represents the active filesystem, but additional universes (e.g. "@backup", "@u1") can be created for snapshots, branching, and isolated changes.

Also any path can be transferred into a subpath of another or even the same universe, producing an identical copy of that subtree.

### Sync Protocol
Uses base64-encoded JSON frames for block + inode replication.

---

## 🧪 API Overview

### Directories
- `fs.mkdir(path)`
- `fs.rmdir(path)`
- `fs.listdir(path)`
- `fs.chdir(path)`
- `fs.getcwd()`

### Files
- `fs.writeFile(path, data, blocksize?)`
- `fs.readFile(path)`
- `fs.rm(path)`

### Files & Directories
- `fs.copy(src, dest)`
- `fs.move(src, dest)`

### Paths
- `fs.abspath(path)`
- `fs.relpath(path, target?)`
- `fs.join(root, path)`
- `fs.split(path)`
- `fs.splitext(path)`

### Metadata
- `fs.metainfo(path)`

### Universes
- `fs.listUniverses()`
- `fs.cloneUniverse(src, name)`
- `fs.deleteUniverse(name)`
- `fs.transfer(srcTree, destTree)`
- `fs.deleteTree(path)`

### Events
- `fs.on(event, handler)`
- `fs.off(event, handler)`
- `fs.onready(func)`

### Sync (sync:true)
- `fs.addTX(sendFunction, interval, frameSize)`
- `fs.pushRX(frame)`

---

## 📌 Use Cases

- [Client-side File-Explorer](Example/SimpleExplorer.html)
- Offline-first editors (text, code, binary)
- [WebXDC](https://webxdc.org) / [DeltaChat](https://delta.chat/) apps
- P2P sync
- Versioning + snapshots
- Git-like branching in-browser

---

## 🤝 Contributing

Issues and feature suggestions are welcome. Contributions are appreciated!
