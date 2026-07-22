"""
# 🤖 AI Service — Harness Core Engine

Provider-agnostic LLM interface. Hỗ trợ:
  - OpenAI-compatible: OpenAI, Gemini (OpenAI compat endpoint), OpenRouter, DeepSeek, Custom
  - Anthropic Claude Messages API

Mỗi method là một "ability" của harness: classify, summarize, analyze.
"""

import json
from typing import Optional, Any

import httpx


class AIService:
    """Wrapper LLM API — engine xử lý thông minh cho Work Log Harness."""

    PROVIDER_OPENAI_STYLE = {"openai", "gemini", "openrouter", "deepseek", "custom"}
    PROVIDER_ANTHROPIC = {"anthropic"}

    PROVIDER_PRESETS: dict[str, dict[str, str]] = {
        "openai": {
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4o",
            "label": "OpenAI",
        },
        "gemini": {
            "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
            "model": "gemini-2.0-flash",
            "label": "Google Gemini",
        },
        "anthropic": {
            "base_url": "https://api.anthropic.com/v1",
            "model": "claude-sonnet-4-20250514",
            "label": "Anthropic",
        },
        "openrouter": {
            "base_url": "https://openrouter.ai/api/v1",
            "model": "openai/gpt-4o",
            "label": "OpenRouter",
        },
        "deepseek": {
            "base_url": "https://api.deepseek.com",
            "model": "deepseek-chat",
            "label": "DeepSeek",
        },
        "custom": {"base_url": "", "model": "", "label": "Custom"},
    }

    PROVIDER_CHOICES = [
        {"id": k, "label": v["label"]} for k, v in PROVIDER_PRESETS.items()
    ]

    def __init__(
        self,
        provider: str,
        api_key: str,
        base_url: str = "",
        model: str = "",
    ):
        self.provider = provider
        self.api_key = api_key

        defaults = self.PROVIDER_PRESETS.get(provider, {})
        self.base_url = (base_url or defaults.get("base_url", "")).rstrip("/")
        self.model = model or defaults.get("model", "")

    # ── Core: chat completion ─────────────────────────

    async def chat(
        self,
        messages: list[dict[str, str]],
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 2000,
        response_json: bool = False,
    ) -> str:
        """Gửi prompt tới LLM và trả về text response."""
        if self.provider in self.PROVIDER_ANTHROPIC:
            return await self._call_anthropic(
                messages, system_prompt, temperature, max_tokens
            )
        return await self._call_openai_style(
            messages, system_prompt, temperature, max_tokens, response_json
        )

    async def _call_openai_style(
        self,
        messages: list[dict[str, str]],
        system_prompt: Optional[str],
        temperature: float,
        max_tokens: int,
        response_json: bool,
    ) -> str:
        full: list[dict[str, str]] = []
        if system_prompt:
            full.append({"role": "system", "content": system_prompt})
        full.extend(messages)

        url = f"{self.base_url}/chat/completions"
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": full,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if response_json:
            payload["response_format"] = {"type": "json_object"}

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    async def _call_anthropic(
        self,
        messages: list[dict[str, str]],
        system_prompt: Optional[str],
        temperature: float,
        max_tokens: int,
    ) -> str:
        url = f"{self.base_url}/messages"

        anthro_messages: list[dict[str, str]] = []
        for msg in messages:
            role = msg.get("role", "user")
            if role != "system":
                anthro_messages.append(
                    {"role": role, "content": msg.get("content", "")}
                )

        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": anthro_messages,
            "temperature": temperature,
        }
        if system_prompt:
            payload["system"] = system_prompt

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["content"][0]["text"]

    # ── Model listing ────────────────────────────────

    async def list_models(self) -> list[dict[str, str]]:
        """Lấy danh sách models từ provider API.

        Returns list of {"id": str, "owned_by": str} or empty list on failure.
        """
        if self.provider in self.PROVIDER_ANTHROPIC:
            # Anthropic không có public models list endpoint
            return []

        url = f"{self.base_url}/models"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                data = resp.json()

                # OpenAI-compatible format: { "data": [{ "id": "...", "owned_by": "..." }, ...] }
                raw_models = data.get("data", [])
                models = []
                seen = set()
                for m in raw_models:
                    mid = m.get("id", "")
                    if mid and mid not in seen:
                        seen.add(mid)
                        models.append({
                            "id": mid,
                            "owned_by": m.get("owned_by", ""),
                        })

                # Ưu tiên model có sẵn ở trên cùng
                models.sort(key=lambda x: (
                    # Các model "chính" lên đầu
                    not x["id"].startswith(("gpt-4", "gemini", "claude", "deepseek")),
                    x["id"],
                ))
                return models
        except Exception:
            return []

    # ── Harness abilities ─────────────────────────────

    async def enhance_log(
        self, title: str, description: str = "", activity_type: str = ""
    ) -> dict:
        """Rewrite description professionally + estimate time.

        Returns dict with:
          enhanced_description: professional 1-3 sentence description
          estimated_minutes: integer (5-480)
          title (optional): slightly improved title
          confidence: float 0.0-1.0
          reasoning: brief explanation
        """
        prompt = f"""You are a professional work log assistant. Given a raw work entry, provide:
- enhanced_description: a professional 1-3 sentence description (write what was done, context, impact)
- estimated_minutes: reasonable time estimate as integer (5-480)
- confidence: float 0.0-1.0 how confident you are
- reasoning: brief one-sentence explanation

Title: {title}
Description: {description or "(empty)"}
Type: {activity_type or "unknown"}

Return ONLY valid JSON."""

        raw = await self.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.15,
            max_tokens=500,
            response_json=True,
        )
        try:
            result = json.loads(raw)
            result["title"] = title  # always keep original title
            return result
        except json.JSONDecodeError:
            return {
                "enhanced_description": description or title,
                "estimated_minutes": 0,
                "title": title,
                "confidence": 0,
                "reasoning": "Failed to parse LLM response",
            }

    async def classify_log(self, title: str, description: str = "") -> dict:
        """Phân loại work log: gợi ý category, time, tags."""
        desc = f"\nDescription: {description}" if description else ""
        prompt = f"""Analyze this work entry and return ONLY valid JSON with these fields:
- category: one of "meeting" | "coding" | "code_review" | "research" | "documentation" | "design" | "planning" | "communication" | "other"
- suggested_time_minutes: reasonable integer estimate (5-480)
- tags: array of 2-4 relevant short tags
- confidence: float 0.0-1.0
- reasoning: brief one-sentence explanation

Title: {title}{desc}"""

        raw = await self.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.15,
            max_tokens=500,
            response_json=True,
        )
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {
                "category": "other",
                "suggested_time_minutes": 0,
                "tags": [],
                "confidence": 0,
                "reasoning": "Failed to parse LLM response",
            }

    async def generate_summary(self, logs: list[dict], period: str = "daily") -> str:
        """Tạo báo cáo tóm tắt work logs bằng natural language."""
        if not logs:
            return "No work logs found for this period."

        lines = "\n".join(
            f"- [{l.get('source','?')}] {l.get('title','')} "
            f"({l.get('activity_type','')}) — {l.get('time_spent_minutes',0)}m"
            for l in logs
        )

        prompt = f"""You are a work log analyst. Given {period} work logs, generate a concise professional summary covering:
1. Key accomplishments
2. Time breakdown by category/type
3. Notable patterns
4. Brief suggestions

Keep under 250 words.

WORK LOGS:
{lines}"""

        return await self.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=1000,
        )

    async def analyze_query(self, logs: list[dict], query: str) -> str:
        """Trả lời câu hỏi natural language về work logs."""
        if not logs:
            return "No work logs available to analyze."

        lines = "\n".join(
            f"- [{l.get('source','?')}] {l.get('title','')} | "
            f"{l.get('activity_timestamp','')[:10]} | "
            f"{l.get('project','')} | {l.get('time_spent_minutes',0)}m"
            for l in logs
        )

        prompt = (
            f"Answer based ONLY on the work log data below.\n\n"
            f"WORK LOGS:\n{lines}\n\n"
            f"QUESTION: {query}\n\n"
            f"Answer concisely. If the data doesn't have enough info, say so."
        )

        return await self.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.15,
            max_tokens=1000,
        )
