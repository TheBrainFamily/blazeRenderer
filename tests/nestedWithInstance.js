Template.parentWithInstance.onCreated(function(){
  this.reactiveVariable = new ReactiveVar("parent - value of reactive variable")

})

Template.parentWithInstance.helpers({
  fromParentTemplateInstance() {
    return Template.instance().reactiveVariable.get()
  }
})

Template.nestedWithInstance.onCreated(function(){
  this.reactiveVariable = new ReactiveVar("nested - value of reactive variable")
})

Template.nestedWithInstance.helpers({
  fromNestedTemplateInstance() {
    return Template.instance().reactiveVariable.get()
  }
})
