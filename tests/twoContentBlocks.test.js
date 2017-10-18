import renderBlaze, { renderBlazeWithData, parseTemplates } from '../blazeRenderer/renderBlaze';

describe('TwoContentBlocks', function () {
  describe('templates', function () {
    it('should be able to render two or more templates with contentBlock inside', function () {
      expect(renderBlaze('wrapper')).toMatchSnapshot()
    })
  })
})
