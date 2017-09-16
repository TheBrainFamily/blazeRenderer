import renderBlaze from './renderblaze/renderBlaze';

describe('template', function() {
    it(' renders properly', function() {

        const helpers = {
          hello: "is it me you looking for?",
          nope: function () { return "from a function" },
          favoriteColors: [{color: "yellow"}, {color: "blue"}, {color: "red"}]
        };

        const html = renderBlaze('./main.html', 'testTemplate', helpers)
        debugger;
        expect(html).toMatchSnapshot()
    })
})