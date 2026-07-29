# calc-inline

Evaluate JavaScript expressions and number selections.

Work through calculations directly in a text editor without switching to a separate calculator.

## Features

- **Expression evaluation**: append results to selected JavaScript expressions.
- **In-place replacement**: replace selected expressions with their results.
- **Batch calculation**: evaluate every selected expression in a single undo step.
- **Extended variables**: reuse earlier results with `_`, `_1`, `_2`, and later names.
- **Math shortcuts**: call functions such as `pow` and `max` without a `Math.` prefix.
- **Selection numbering**: replace each selection with its zero-based or configured index.

## Installation

To install `calc-inline` search for _calc-inline_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/calc-inline`.

## Commands

Commands available in `atom-text-editor`:

- `calc-inline:evaluate`: append each selected expression's result,
- `calc-inline:replace`: replace each selected expression with its result,
- `calc-inline:count`: replace each selection with its index.

## Usage

With no selection, evaluation can process the document one line at a time. Blank lines and lines beginning with `//` are skipped.

When extended variables are enabled, `i` is the current selection index, `_` is the previous result, and `_1`, `_2`, and later names retain results from the current run. `Math.pwd(length)` and its `Math.password` alias generate a random printable string; the default length is 20.

Math shortcuts are enabled by default, so `pow(2, 8)` and `Math.pow(2, 8)` both evaluate to `256`.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
