Template.templateWithContentBlockInside.helpers({
  myOwnHelper: function(arg1) {
    return `this is from my own helper ${arg1} ${Template.instance().data.test}`
  }
})
