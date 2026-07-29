# Next

- Adapted the package for Lumine and moved its source, menus, and specs to JavaScript and JSON.
- Added evaluation timeouts and editor notifications for invalid expressions.
- Fixed result numbering, stale extended variables, cursor restoration, and one-step undo behavior.
- Added ESLint, Prettier, Jasmine 6 integration coverage, and cross-platform CI.

# 0.4.0

- Added Expression Sanitization

## 0.3.8

- Fixed `withMath` breaking on expressions that contain comments

## 0.3.7

- Fixed selecting the first expression on no-selection evaluation / replace

## 0.3.6

- Added activation commands

## 0.3.5

- Added single-line comments to lines to ignore

## 0.3.4

- Forced `calc-inline:evaluate` and `calc-inline:replace` to skip empty selections
- Fixed name mismatch bug relating to `calc-inline:count` command
- Removed default keymap

## 0.3.3

- Fixed multi-selection calculations not being one-step undo

## 0.3.2

- Fixed error on selection based evaluation with returning cursor position

## 0.3.1

- Fixed `Math.pwd`

# 0.3.0

- Added `_n` magic variables
- Added option to evaluate all lines on empty selection

# 0.2.0

- Added `Math.pwd`

# 0.1.0

- Added `evaluate`, `replace`, and `count`
