# Required Input Schema

```yaml
feature: string
scope: string
goal: string

preconditions:
  - string

input_expected:
  - string

output_expected:
  - string

assertion_rationale:
  - string

observability:
  primary:
    - string
  secondary:
    - string
  unreliable:
    - string

false_positive_risks:
  - string

test_type: smoke | e2e | integration | visual | a11y | performance | contract
determinism_level: low | medium | high
```
