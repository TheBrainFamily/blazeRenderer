import { renderBlazeWithData, parseTemplates, renderBlazeWithTemplates } from './renderblaze/renderBlaze';


describe('template', function () {
    it(' renders properly', function () {
        const helpers = {
            hello: "is it me you looking for?",
            nope: function () {
                return "from a function"
            },
            favoriteColors: [{color: "yellow"}, {color: "blue"}, {color: "red"}]
        };
        const html = renderBlazeWithData('./main.html', 'testTemplate', helpers)
        expect(html).toMatchSnapshot()
    })
    it('renders properly meteor-style', function () {

    })
})

it('parse templates', () => {
    expect(parseTemplates(['./main.html', './additionalTemplates.html'])).toMatchSnapshot()
})

it('renders templates included cross-files', () => {
    const parsedTemplates = parseTemplates(['./main.html', './additionalTemplates.html']);

    expect(renderBlazeWithTemplates('templateFromExternalFile', parsedTemplates)).toMatchSnapshot()

})

it('renders templates in file without data implicitly passed to it', () => {
    require('./main.js')
    const parsedTemplates = parseTemplates(['./main.html']);

    expect(renderBlazeWithTemplates('testTemplate', parsedTemplates)).toMatchSnapshot()
})

it('renders template with onCreated callback and using Template.instance()', () => {
    require('./onCreatedTemplate.js')
    const parsedTemplates = parseTemplates(['./onCreatedTemplate.html'])
    expect(renderBlazeWithTemplates('onCreatedTemplate', parsedTemplates)).toMatchSnapshot()
})

it('renders template with onCreated callback and using Template.instance() with two templates, one nested', () => {
  require('./nestedWithInstance.js')
  const parsedTemplates = parseTemplates(['./nestedWithInstance.html'])
  expect(renderBlazeWithTemplates('parentWithInstance', parsedTemplates)).toMatchSnapshot()
})

it('renders nested template with params', () => {
  require('./nestedTemplateWithParameters')
  const parsedTemplates = parseTemplates(['./nestedTemplateWithParameters.html'])
  expect(renderBlazeWithTemplates('parentTemplate', parsedTemplates)).toMatchSnapshot()

})