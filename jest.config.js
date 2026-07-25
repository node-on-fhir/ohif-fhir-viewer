const path = require('path');

// dcmjs is not a direct dependency of this extension — at bundle time it
// resolves from the OHIF build (see the peer-deps note in README.md), and
// hoisting it into our own node_modules would change that resolution. For
// tests, prefer the sibling Viewers copy (the version the shipped app actually
// uses) and fall back to the copy that ships with dcmjs-ecg.
function resolveDcmjs() {
  const viewersCopy = path.resolve(__dirname, '../Viewers/node_modules/dcmjs');
  try {
    require.resolve(path.join(viewersCopy, 'package.json'));
    return viewersCopy;
  } catch (e) {
    return path.dirname(
      require.resolve('dcmjs/package.json', {
        paths: [path.dirname(require.resolve('dcmjs-ecg/package.json'))],
      })
    );
  }
}

module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.js'],
  moduleNameMapper: {
    '^dcmjs$': resolveDcmjs(),
  },
};
