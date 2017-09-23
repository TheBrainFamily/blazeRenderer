Template.parentTemplate.helpers({
  hello: function() {
    return "is it?";
  }
})


Template.nestedWithParams.helpers({
  almostReactivelyWithParentParam: function() {
    return Template.instance().reactiveVariableWithParam.get()
  }
})

Template.nestedWithParams.onCreated(function() {
  this.reactiveVariableWithParam = new ReactiveVar(this.data.param)
})