"""
analytics_demo.py
Simulate a single analytics operation via the AlloyAPI proxy:
  - Measures elapsed time
  - Prints prompt and completion token usage
  - Estimates cost based on model pricing
  - Logs the LLM response
"""
import time
import os
from openai import OpenAI

# Configuration
API_URL = os.getenv('OPENAI_BASE_URL', 'https://alloyapi.ai.studio/v1')
API_KEY = os.getenv('OPENAI_API_KEY', 'sk-alloy-4f877e913f0ad0aef3ef7b15dc831408')
MODEL = 'gpt-4o-mini'
# Pricing per 1M tokens (USD)
PRICING = {
    'gpt-4o-mini': {'input_per_1m': 0.15, 'output_per_1m': 0.60}
}

def main():
    client = OpenAI(
        base_url=API_URL,
        api_key=API_KEY
    )

    # Define the analytics task as a prompt
    messages = [
        {"role": "system", "content": "You are an analytics assistant."},
        {"role": "user", "content": (
            "Given the sales data for Q1 and Q2, "
            "provide a 2-sentence summary of trends and anomalies.\n"
            "Data: [ 'Q1: 15000, 16000, 17000', 'Q2: 18000, 20000, 22000' ]"
        )}
    ]
    max_tokens = 60

    # Measure elapsed time
    start = time.time()
    response = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        max_tokens=max_tokens
    )
    elapsed_s = time.time() - start

    # Extract token usage
    usage = response.usage
    prompt_tokens = usage.prompt_tokens
    completion_tokens = usage.completion_tokens
    total_tokens = usage.total_tokens

    # Estimate cost
    pricing = PRICING.get(MODEL, PRICING['gpt-4o-mini'])
    cost_input = prompt_tokens / 1_000_000 * pricing['input_per_1m']
    cost_output = completion_tokens / 1_000_000 * pricing['output_per_1m']
    total_cost = cost_input + cost_output

    # Print results
    print(f"Task: Analytics summary of Q1/Q2 sales data")
    print(f"Elapsed time: {elapsed_s*1000:.2f} ms")
    print(f"Tokens - Prompt: {prompt_tokens}, Completion: {completion_tokens}, Total: {total_tokens}")
    print(f"Estimated cost: ${total_cost:.6f} USD")
    print("---\nResponse:")
    print(response.choices[0].message.content.strip())

if __name__ == '__main__':
    main()