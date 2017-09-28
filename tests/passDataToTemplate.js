Template.passDataToTemplate.helpers({
	dataSource: () => ({key: {value: "some value"}})
});
Template.templateToPassDataTo.helpers({
	displayHelper: value => value
});