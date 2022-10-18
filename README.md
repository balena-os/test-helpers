# Leviathan Test Helpers

Repository to hold all test helpers being used for test execution in [Leviathan](https://github.com/balena-os/leviathan) automated testing. These helpers were pulled from Leviathan's core and almost all of them have been written in Typescript.

Check out the [documentation](https://balena-os.github.io/test-helpers) for the test helpers. 

## Using the helpers

You can start using the helpers by:

1. Install the helpers package

```
npm install @balena/leviathan-test-helpers
```

2. Import the helpers package in the tests.

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

## Developing/Contributing to the helpers

For a faster development cycle when contributing to the helpers, try this workflow. 

1. Make a change to the helpers. 
2. Run the command `npm pack`. This will generated a compressed archive of the package. 
3. Move this archive to the root of test directory. 
4. Modify the package.json's dependencies section to use the local version of the test-helpers package as follows:

```
{
	"dependencies": {
		"@balena/leviathan-test-helpers": "file:NAME-OF-COMPRESSED-ARCHIVE-FOR-THE-PACKAGE.tgz",
        ...
	}
}

```
5. Run `npm install`
6. The tests will now be using your modified version of the package. 
7. When finished, don't forget to change the package.json back to the original state. 