Template.toTable.helpers({
  tableRowData: () => [
    {name: 'first', number: 1, dates: {month: 'January'}},
    {name: 'second', number: 2, dates: {month: 'February'}},
    {name: 'third', number: 3, dates: {month: 'March'}}
  ]
})

Template.someOtherTemplate.helpers({
  printThisHelper: (value) => value
})
