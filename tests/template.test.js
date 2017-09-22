import { renderBlazeWithData, parseTemplates, renderBlazeWithTemplates } from '../renderblaze/renderBlaze';
import returnAllTemplates from '../renderBlaze/returnAllTemplates';

describe('template', function () {
    it(' renders properly', function () {
        const helpers = {
            hello: "is it me you looking for?",
            nope: function () {
                return "from a function"
            },
            favoriteColors: [{color: "yellow"}, {color: "blue"}, {color: "red"}]
        };
        const html = renderBlazeWithData('imports/client/lib/main.html', 'testTemplate', helpers)
        expect(html).toMatchSnapshot()
    })
    it('renders properly meteor-style', function () {

    })
})

it('parse templates', () => {
    expect(parseTemplates(returnAllTemplates('imports/'))).toMatchSnapshot()
})

it('renders templates included cross-files', () => {
    expect(renderBlazeWithTemplates('templateFromExternalFile')).toMatchSnapshot()

})

it('renders templates in file without data implicitly passed to it', () => {
    require('./main')
    expect(renderBlazeWithTemplates('testTemplate')).toMatchSnapshot()
})

it('renders template with onCreated callback and using Template.instance()', () => {
    require('./onCreatedTemplate')
    expect(renderBlazeWithTemplates('onCreatedTemplate')).toMatchSnapshot()
})

it('renders template with onCreated callback and using Template.instance() with two templates, one nested', () => {
  require('./nestedWithInstance')
  expect(renderBlazeWithTemplates('parentWithInstance')).toMatchSnapshot()
})

it('renders nested template with params', () => {
  require('./nestedTemplateWithParameters')
  expect(renderBlazeWithTemplates('parentTemplate')).toMatchSnapshot()
})