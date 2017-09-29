Template.templateWithContentBlockOut.helpers({
  list: () => [{something: 'args'}, {something: 'in'}, {something: 'list'}],
  innerBlockData: () => [{arg: 'first'}, {arg: 'second'}]
})

Template.templateWithContentBlockInside.onCreated(function() {
  console.log("WILK: this",this);
})
