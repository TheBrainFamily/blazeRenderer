Template.passDataToTemplate.helpers({
	dataSource: () => ({key: {value: "some value"}})
});
Template.anotherTemplate.helpers({
	displayHelper: value => value
});