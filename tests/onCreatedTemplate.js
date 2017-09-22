
Template.onCreatedTemplate.onCreated(function() {
  this.reactiveVariable = new ReactiveVar("value of reactive variable")
})

Template.onCreatedTemplate.helpers({
  fromTemplateInstance() {
    return Template.instance().reactiveVariable.get()
  }
})
