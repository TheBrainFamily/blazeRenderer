Template.thisInsideEach.helpers({
  arrayArg: () => ['one', 'two'],
  logoutArray: (arg) => arg,
  objectArg: () => [{one: 'uno', two: 'two'}, {one: 'dos', two: 'two'}],
  logoutObject: ({one}) => one,
})
