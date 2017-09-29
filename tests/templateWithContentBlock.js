Template.templateWithContentBlockOut.helpers({
  list: () => [{something: 'args'}, {something: 'in'}, {something: 'list'}],
  innerBlockData: () => [{arg: 'first'}, {arg: 'second'}]
})

Template.templateWithContentBlockInside.helpers({
  myOwnHelper: function(arg1) {
    return `this is from my own helper ${arg1} ${Template.instance().data.someString}`
  }
})
