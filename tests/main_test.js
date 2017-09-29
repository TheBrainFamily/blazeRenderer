import {renderBlazeWithData, parseTemplates} from '../blazeRenderer/renderBlaze';

// Things left so far:
// a) included templates should have the parent data shifted by one (../color should work as color)
// A1) - above done, but you always have data of your parent, we need to check ../.. still
//     - this might work, but each inside each inside each is broken
// b) includeReplacement should be attached to all nested views (inside each for example)
// how is this going to work with cursors?
// c) include regexp doesnt work for {{> something}} <-- no space

const helpers = {
  hello: "is it me you looking for?",
  nope: function () { return "from a function" },
  favoriteColors: function() {
    return [{color: "yellow"}, {color: "blue"}, {color: "red"}]
  },
    favoriteSizes: function() {
      return [{size: "large"}, {size: "small"}]
    },
    favoriteClothes: function() {
        return [{clothe: "trousers"}, {clothe: "tshirt"}, {clothe: "pants"}]
    },
    thisIsTrue: function() { console.log("inside true"); return true },
    thisIsNotTrue: function() { console.log("inside not true"); return false}
};

const html = renderBlazeWithData('./main.html', 'testTemplate', helpers)

// console.log(html)

parseTemplates('./main.html')