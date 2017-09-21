class _ReactiveVar {
  constructor(value) {
    this.value = value;
  }
  set(value) {
    this.value = value;
  }
  get() {
    return this.value;
  }
}

ReactiveVar = _ReactiveVar