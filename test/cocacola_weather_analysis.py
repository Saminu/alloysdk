"""
test/cocacola_weather_analysis.py
Simulate an analytics query to understand why Coca-Cola's revenue dropped in July 2026 vs July 2025,
and investigate possible correlation with weather data.
Environment variables:
  - OPENAI_BASE_URL: URL of the AlloyAPI proxy (e.g. https://alloyapi.ai.studio/v1)
  - OPENAI_API_KEY: the Alloy API key
"""
import os
import sys
import time
from openai import OpenAI

# Load configuration
API_URL = os.getenv('OPENAI_BASE_URL')
API_KEY = os.getenv('OPENAI_API_KEY')
if not API_URL or not API_KEY:
    print("Error: set OPENAI_BASE_URL and OPENAI_API_KEY in environment.")
    sys.exit(1)

# Model and pricing catalog
MODEL = 'gpt-4o-mini'
PRICING = {
    'gpt-4o-mini': {'input_per_1m': 0.15, 'output_per_1m': 0.60}
}

def format_data():
    # Sample revenue and weather data
    return (
        "Revenue by week: "
        "2025-07: [52.3, 54.1, 53.8, 55.0] million USD; "
        "2026-07: [48.7, 49.2, 50.1, 51.0] million USD. "
        "Average weekly temperatures: "
        "2025-07: [30°C, 32°C, 31°C, 29°C]; "
        "2026-07: [33°C, 34°C, 35°C, 33°C]."
    )

def main():
    client = OpenAI(base_url=API_URL, api_key=API_KEY)

    messages = [
        {"role": "system", "content": "You are a business analytics assistant."},
        {"role": "user", "content": (
            "Compare Coca-Cola's weekly revenue in July 2025 vs July 2026 and "
            "identify why revenue dropped in July 2026. " + format_data()
        )}
    ]
    max_tokens = 100

    # Call and measure
    start = time.time()
    resp = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        max_tokens=max_tokens
    )
    elapsed_ms = (time.time() - start) * 1000

    # Token usage and cost
    usage = resp.usage
    pt = usage.prompt_tokens
    ct = usage.completion_tokens
    total = usage.total_tokens
    price = PRICING.get(MODEL)
    cost = (pt/1e6)*price['input_per_1m'] + (ct/1e6)*price['output_per_1m']

    # Output
    print(f"Analysis Task: Coca-Cola July 2026 vs 2025 revenue drop")
    print(f"Elapsed time   : {elapsed_ms:.2f} ms")
    print(f"Tokens used    : prompt={pt}, completion={ct}, total={total}")
    print(f"Estimated cost : ${cost:.6f} USD")
    print("---\nInsight:")
    print(resp.choices[0].message.content.strip())

if __name__ == '__main__':
    main()