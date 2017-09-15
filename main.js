import renderBlaze from './renderblaze/renderBlaze';

const helpers = {
  hello: "is it me you looking for?",
  nope: function () { return "from a function" },
  favoriteColors: function() {
    console.log("inside")
    return [{color: "yellow"}, {color: "blue"}, {color: "red"}]
  }
};

const html = renderBlaze('./main.html', 'testTemplate', helpers)

console.log(html)