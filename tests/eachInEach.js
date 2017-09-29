Template.eachInEach.helpers({
	thing: function () {
		return [
			{
				hasLabel: "thingLabel",
				thingInThing: [
					{hasLabel: "thingInThingLabel"}
				]
			}
		]
	}
})
Template.inEach.helpers({
	inEachThing: function (argument) {
		return [
			{
				hasLabel: "inEachThingLabel",
				andValue: "someValue"
			}
		]
	}
})