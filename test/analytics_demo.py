"""
test/analytics_demo.py
Simulate a single analytics operation via the AlloyAPI proxy.
Reads API key and base URL from environment variables to avoid hard-coded secrets.
"""
import time
import os
import sys
from openai import OpenAI

# Load configuration from environment
API_URL = os.getenv('OPENAI_BASE_URL')
API_KEY = os.getenv('OPENAI_API_KEY')
if not API_URL or not API_KEY:
    print("Error: Please set OPENAI_BASE_URL and OPENAI_API_KEY in your environment.")
    sys.exit(1)

# Model and pricing
MODEL = 'gpt-4o-mini'
PRICING = {
    'gpt-4o-mini': {'input_per_1m': 0.15, 'output_per_1m': 0.60}
}

def main():
    client = OpenAI(
        base_url=API_URL,
        api_key=API_KEY
    )

    # Define analytics task
    messages = [
        {"role": "system", "content": "You are an analytics assistant."},
        {"role": "user", "content": (
            "Given Q1 and Q2 sales data, summarize trends in 2 sentences.\n"
            "Data: [ 'Q1:15000,16000,17000', 'Q2:18000,20000,22000' ]"
        )}
    ]
    max_tokens = 60

    # Measure request time
    start = time.time()
    response = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        max_tokens=max_tokens
    )
    elapsed_ms = (time.time() - start) * 1000

    # Token usage
    usage = response.usage
    prompt_tokens = usage.prompt_tokens
    completion_tokens = usage.completion_tokens
    total_tokens = usage.total_tokens

    # Estimate cost
    p = PRICING.get(MODEL, PRICING['gpt-4o-mini'])
    cost = (prompt_tokens / 1_000_000) * p['input_per_1m'] + \
           (completion_tokens / 1_000_000) * p['output_per_1m']

    # Output results
    print(f"Task           : Analytics summary of Q1/Q2 sales data")
    print(f"Elapsed time   : {elapsed_ms:.2f} ms")
    print(f"Tokens used    : prompt={prompt_tokens}, completion={completion_tokens}, total={total_tokens}")
    print(f"Estimated cost : ${cost:.6f} USD")
    print("Response       :", response.choices[0].message.content.strip())

if __name__ == '__main__':
    main()