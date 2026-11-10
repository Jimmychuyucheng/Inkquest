"""讀取 shared/personas.yaml 的 20 位陪審員人設。"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from .config import SHARED_DIR

PERSONAS_PATH = SHARED_DIR / "personas.yaml"

Group = Literal["文學專業", "一般讀者", "跨界視角"]


class Persona(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(pattern=r"^J\d{2}$")
    name: str
    group: Group
    background: str
    focus: str
    tone: str
    enabled: bool = True
    version: int = Field(default=1, ge=1)


def load_personas(path: Path | None = None) -> list[Persona]:
    with open(path or PERSONAS_PATH, encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    personas = [Persona.model_validate(item) for item in raw["personas"]]
    codes = [p.code for p in personas]
    if len(codes) != len(set(codes)):
        raise ValueError("personas.yaml 中有重複的陪審員編號")
    return personas


def get_persona(code: str, personas: list[Persona] | None = None) -> Persona:
    for persona in personas if personas is not None else load_personas():
        if persona.code == code.upper():
            return persona
    raise KeyError(f"找不到陪審員 {code}，可用的編號是 J01～J20")
