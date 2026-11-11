`bin2-edgecases.snapshot.json` is real `schemamap extract` output for `SchemaMapEdgeCasesBIN2` as
`schemamap_reader` (lab up), with `captured_at`, `source.product_version` and `source.server`
normalised the way the AdventureWorks golden is (see `cli/tests/test_extract_command_integration.py`).
Regenerate it by re-running the extract and the same normalisation; never edit it by hand.
The AdventureWorks golden is read directly from `cli/tests/fixtures/`.
