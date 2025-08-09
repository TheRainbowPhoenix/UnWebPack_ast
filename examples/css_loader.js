// Simulate __webpack_require__(7) → css-loader/lib/css-base
const makeCssList = require('css-loader/lib/css-base');

// Create the CSS "bucket"
const cssExports = makeCssList(false); // false = don't use source maps

// Add CSS rules
cssExports.push([
  null, // moduleId (not used here)
  '.my-class { color: red; }',
  '',   // media query
  null  // source map
]);

// Attach CSS Module locals (for :local .className mapping)
cssExports.locals = {
  myClass: 'source-client-...',
};

// Later, when style-loader runs:
const cssString = cssExports.toString();
// → injects '.my-class { color: red; }' into a <style> tag