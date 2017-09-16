import renderBlaze from './renderblaze/renderBlaze';

// Two things left so far:
// a) included templates should have the parent data shifted by one (../color should work as color)
// b) includeReplacement should be attached to all nested views (inside each for example)
// how is this going to work with cursors?

const helpers = {
  hello: "is it me you looking for?",
  nope: function () { return "from a function" },
  favoriteColors: function() {
    return [{color: "yellow"}, {color: "blue"}, {color: "red"}]
  },
    thisIsTrue: function() { console.log("inside true"); return true },
    thisIsNotTrue: function() { console.log("inside not true"); return false}
};

const html = renderBlaze('./main.html', 'testTemplate', helpers)

console.log(html)