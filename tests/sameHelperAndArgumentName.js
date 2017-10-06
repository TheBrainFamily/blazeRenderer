Template.templateWithHelperLikeArgument.helpers({
  parameterLikeHelper: () => {
    return Template.instance().data.parameterLikeHelper || 'defaultText';
  }
})
