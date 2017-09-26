Template.parentTemplate.helpers({
  hello: function() {
    return "is it?";
  },
  returnObject: function() {
    return [{
      thing: {
      inside: {
        object: 'thing'}
      }
    }, {
      thing: {
        inside: {
          object: 'another'}
      }
    }]
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

Template.anotherNestedWithObjectParam.helpers({
  almostReactivelyWithParentParam: function() {
    return Template.instance().reactiveVariableWithParam.get()
  }
})
