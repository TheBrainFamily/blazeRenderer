import renderBlaze from '../blazeRenderer/renderBlaze'

describe('other tests', () => {
  it('template handles situation where passed parameter name is the same like helper name', () => {
    require('./sameHelperAndArgumentName')
    expect(renderBlaze('sameHelperAndArgumentNameTemplate')).toMatchSnapshot()
  })
})
