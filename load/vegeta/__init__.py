"""C268.2: vegeta's targets and runs, generated from the seeded ids (load-harness).

vegeta v12.13.0 (MIT) is installed by infra/scripts/install-vegeta.sh into the tools directory; its
targets stream to `vegeta attack -lazy` on standard input and are never written to a file, and its
results (no bodies) go under load/results/ (outside git).
"""

from vegeta.targets import (
    MIN_ACHIEVED_RATE_SHARE,
    VEGETA_CPU,
    VEGETA_VERSION,
    VegetaTake,
    achieved_rate,
    attack_command,
    cycle,
    parse_results,
    run_take,
    target_line,
    targets,
)

__all__ = [
    "MIN_ACHIEVED_RATE_SHARE",
    "VEGETA_CPU",
    "VEGETA_VERSION",
    "VegetaTake",
    "achieved_rate",
    "attack_command",
    "cycle",
    "parse_results",
    "run_take",
    "target_line",
    "targets",
]
