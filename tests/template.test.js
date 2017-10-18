import renderBlaze, { renderBlazeWithData, parseTemplates } from '../blazeRenderer/renderBlaze';
import returnAllTemplates from '../blazeRenderer/returnAllTemplates';

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
})

it('parse templates', () => {
    expect(parseTemplates(returnAllTemplates('imports/'))).toMatchSnapshot()
})

it('renders templates included cross-files', () => {
    expect(renderBlaze('templateFromExternalFile')).toMatchSnapshot()

})

it('renders templates in file without data implicitly passed to it', () => {
    require('./main')
    expect(renderBlaze('testTemplate')).toMatchSnapshot()
})

it('renders template with onCreated callback and using Template.instance()', () => {
    require('./onCreatedTemplate')
    expect(renderBlaze('onCreatedTemplate')).toMatchSnapshot()
})

it('renders template with onCreated callback and using Template.instance() with two templates, one nested', () => {
  require('./nestedWithInstance')
  expect(renderBlaze('parentWithInstance')).toMatchSnapshot()
})

it('renders nested template with params and this.data in onCreated', () => {
  require('./nestedTemplateWithParameters')

  expect(renderBlaze('parentTemplate')).toMatchSnapshot()
})


it('renders template with with', () => {
  require('./withWith')

  expect(renderBlaze('withWith')).toMatchSnapshot()
})

it('renders properly each inside each inside each', () => {
  require('./eachInsideEachInsideEach')

  expect(renderBlaze('eachInsideEachInsideEach')).toMatchSnapshot()
})

it('should have access to functions added by registerHelper', () => {
  require('./registeredHelper')

  expect(renderBlaze('forRegisteredHelper')).toMatchSnapshot()
})

it('renders templateWithContentBlock', () => {
  require('./templateWithContentBlock')
  expect(renderBlaze('templateWithContentBlockOut')).toMatchSnapshot()
})

it('helpers take arguments properly', () => {
  require('./helpersWithArguments')
  expect(renderBlaze('helpersWithArguments')).toMatchSnapshot()
})

it('template pass arguments properly', () => {
	require('./passDataToTemplate')
	expect(renderBlaze('passDataToTemplate')).toMatchSnapshot()
})

it('template renders contentBlock in right order', () => {
  require('./toTable')
  expect(renderBlaze('toTable')).toMatchSnapshot()
})

it('should execute helper function inside template when calling {{helperName}} not a passed parameter that has the same name - {{helperName}}', () => {
  require('./renderMultipleSelect')
  expect(renderBlaze('testMultiple')).toMatchSnapshot()
})
//TODO need a test for skipping the each on undefined.

//TODO need a test for helper with a value of undefined

//TODO need a test for multiline {{#templateName
