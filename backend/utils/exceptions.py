class UHIBaseException(Exception):
    def __init__(self, code: str, detail: str, safe_message: str) -> None:
        self.code = code
        self.detail = detail
        self.safe_message = safe_message
        super().__init__(detail)


class GEEServiceError(UHIBaseException):
    pass


class ValidationError(UHIBaseException):
    pass
