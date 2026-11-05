export class FigmaError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'FigmaError'
    this.code = code
    this.status = status
  }
}

export function publicError(error) {
  return error instanceof FigmaError ? error : new FigmaError('internal_error', '操作失败，请稍后重试；Token 未对外显示。', 500)
}
