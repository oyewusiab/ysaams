import '@testing-library/jest-dom'

// Ensure jsdom environment has safe URL objectURL stubs for asynchronous Blob download cleanup
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => {}
}
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:mock-url'
}

