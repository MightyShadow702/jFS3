# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
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
