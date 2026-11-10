"""讀取 shared/personas.yaml 的 20 位陪審員人設與各組別的用詞規則。"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .config import SHARED_DIR

PERSONAS_PATH = SHARED_DIR / "personas.yaml"

Group = Literal["文學專業", "一般讀者", "跨界視角"]
LAY_GROUPS: tuple[str, ...] = ("一般讀者", "跨界視角")


class Persona(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(pattern=r"^J\d{2}$")
    name: str
    group: Group
    background: str
    focus: str
    tone: str
    voice_sample: str = Field(min_length=1)
    vocabulary_rule: str = Field(min_length=1)
    enabled: bool = True
    version: int = Field(default=1, ge=1)


class PersonaFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lay_banned_terms: list[str] = Field(min_length=1)
    group_rules: dict[Group, str]
    personas: list[Persona]

    @model_validator(mode="after")
    def _check(self) -> "PersonaFile":
        codes = [p.code for p in self.personas]
        if len(codes) != len(set(codes)):
            raise ValueError("personas.yaml 中有重複的陪審員編號")
        missing = {p.group for p in self.personas} - set(self.group_rules)
        if missing:
            raise ValueError(f"personas.yaml 的 group_rules 缺少組別：{'、'.join(sorted(missing))}")
        return self

    def group_rule_for(self, group: str) -> str:
        """該組別要加進 system prompt 的規則，已填入禁用術語清單。"""
        return self.group_rules[group].replace("{banned_terms}", "、".join(self.lay_banned_terms))


@lru_cache(maxsize=4)
def _load(path: Path) -> PersonaFile:
    with open(path, encoding="utf-8") as f:
        return PersonaFile.model_validate(yaml.safe_load(f))


def load_persona_file(path: Path | None = None) -> PersonaFile:
    return _load(path or PERSONAS_PATH)


def load_personas(path: Path | None = None) -> list[Persona]:
    return list(load_persona_file(path).personas)


def get_persona(code: str, personas: list[Persona] | None = None) -> Persona:
    for persona in personas if personas is not None else load_personas():
        if persona.code == code.upper():
            return persona
    raise KeyError(f"找不到陪審員 {code}，可用的編號是 J01～J20")
