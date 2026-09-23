import re

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class ApiInput(ApiModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


def clean_text(value: str, *, field: str, max_len: int, allow_newlines: bool = False) -> str:
    text = value.strip()
    if allow_newlines:
        text = text.replace("\r\n", "\n")
        bad = _CONTROL.sub("", text.replace("\n", "").replace("\t", "")) != text.replace("\n", "").replace("\t", "")
    else:
        text = re.sub(r"\s+", " ", text)
        bad = bool(_CONTROL.search(text))
    if bad:
        raise ValueError(f"{field} contains control characters")
    if len(text) > max_len:
        raise ValueError(f"{field} must be at most {max_len} characters")
    return text
