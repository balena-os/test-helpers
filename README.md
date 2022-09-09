# Leviathan Test Helpers

Repository to hold all test helpers being used in [Leviathan](https://github.com/balena-os/leviathan) testing framework. The helpers are written in Typescript.

Check out the [documentation](https://balena-os.github.io/test-helpers) for the test helpers. 


## Import the helpers

You can start using the helpers by:

1. Install the helpers package

```
npm install @balena/leviathan-test-helpers
```

2. Import the helpers package

```
import sdk from '@balena/leviathan-test-helpers'

sdk.fetchOS('latest', 'fincm3')
```

## External Dependencies needed 

1. **balenaCLI**: https://github.com/balena-io/balena-cli/blob/master/INSTALL.md
2. **Leviathan testing framework**: https://github.com/balena-os/leviathan

## Documentation for Leviathan Helpers

Documentation for Leviathan helpers can be found on [https://balena-os.github.io/test-helpers](https://balena-os.github.io/test-helpers). To generate the documentation, run the following command from either the root of the repository or the `core` directory.

```bash
npm install
npm run docs
```

If the docs are generated successfully, you will be getting the success line as:

```bash
Info: Documentation generated at /path/to/documentation
```