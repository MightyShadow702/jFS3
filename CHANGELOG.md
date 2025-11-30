# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [v1.0.3] - 2025-11-30
### Added
- Add: listUniverses, createUniverse and deleteUniverse functions
- Add: events create-universe and delete-universe
### Changes
- Change: deleteTransfer to deleteTree to clarify its functions
- Change: events create-transfer and delete-transfer to create-tree and delete-tree
### Fixes
- Fixes: transfer now just can create new trees if at least the parent exists inside of the filesystem.
### Breaks
- Break: .deleteTransfer now replaced with .deleteTree
- Break: transfer events now are called tree events instead

## [v1.0.2] - 2025-11-30
### Added
- Add: .onready function to init when FS is ready
### Changes
- Change: default sync interval to 500 ms
- Change: inodes from localStorage to indexDB based
- Rename: .blocks to .backend (now technically containing inodes and blocks)
### Breaks
- Breaks: Migration from 1.0.1

## [v1.0.1] - 2025-11-29
### Changes
- Change: default blocksize to 4096 Byte
- Make sync opt-in.

## [v1.0] - 2025-11-29
### Initial release
