"""A synthetic seed record for the scenario tests: the shape `seed:load` writes, small, every value
made up (keys contain "synthetic", emails at example.com, documentation addresses)."""

from __future__ import annotations

from typing import Any

from scenarios.seed import SEED_SCHEMA, Seed

POOLS = {
    "api-reads": ["load-a sandbox"],
    "api-writes": ["load-a sandbox"],
    "flow": ["load-a sandbox"],
    "webhook": ["load-b sandbox"],
    "screening": ["load-s01 sandbox", "load-s02 sandbox"],
    "connect-source": ["load-a sandbox"],
    "connect-destination": ["load-b sandbox"],
    "export": ["load-s05 sandbox", "load-s06 sandbox"],
    "fairness-flooder": ["load-s11 sandbox"],
    "fairness-victim": ["load-s12 sandbox"],
    "limiter": ["load-a sandbox"],
    "lists-import": ["load-s13 sandbox"],
    "lists-match": ["load-a sandbox"],
    "graph": ["load-s01 sandbox", "load-s01 production"],
    "transactions-write": ["load-b sandbox"],
    "transactions-search": ["load-b sandbox"],
}
ENVIRONMENTS = sorted({env for envs in POOLS.values() for env in envs})


def record(*, keys_per_pool: int = 4, users: int = 40, ids: int = 50) -> dict[str, Any]:
    keys = {
        pool: [
            {"token": f"ov_sandbox_synthetic_{pool}_{i}", "environment": envs[i % len(envs)]}
            for i in range(keys_per_pool)
        ]
        for pool, envs in POOLS.items()
    }
    id_pools: dict[str, list[str]] = {
        name: [f"{prefix}_synthetic{name}{i:04d}" for i in range(ids)]
        for name, prefix in (
            ("settled-inquiries", "inq"),
            ("review-inquiries", "inq"),
            ("write-inquiries", "inq"),
            ("flow-inquiries", "inq"),
            ("verification-inquiries", "inq"),
            ("accounts", "acc"),
            ("connect-source-inquiries", "inq"),
        )
    }
    id_pools["screening-names"] = [f"Loadfirst{i}|Loadlast{i}" for i in range(ids)]
    for env in ENVIRONMENTS:
        id_pools[f"export-accounts:{env}"] = [f"acc_synthexport{i}" for i in range(5)]
        id_pools[f"graph-accounts:{env}"] = [f"acc_synthgraph{i}" for i in range(5)]
    refs = {
        "template:load-a": "itmpl_synthetica",
        "template:load-b": "itmpl_syntheticb",
        "transaction-type:load-b": "txntp_synthetic",
        "connect-connection": "cxn_synthetic",
    }
    for env in ENVIRONMENTS:
        refs[f"watchlist-template:{env}"] = f"rptp_synthetic{env.replace(' ', '')}"
        refs[f"graph-template:{env}"] = f"grqt_synthetic{env.replace(' ', '')}"
        for kind in ("email-addresses", "phone-numbers", "names", "ip-addresses"):
            refs[f"import-list:{kind}:{env}"] = f"lst_synthetic{kind}"
    return {
        "schema": SEED_SCHEMA,
        "scale": "small",
        "keys": keys,
        "users": [
            {
                "email": f"load-user-{i}@example.com",
                "password": f"synthetic-password-{i}",
                "totp-secret": "JBSWY3DPEHPK3PXP",
                "organisation": "load-a" if i % 2 == 0 else "load-b",
                "address": f"2001:db8:4c00::{i + 1:x}",
            }
            for i in range(users)
        ],
        "ids": id_pools,
        "refs": refs,
    }


def synthetic_seed(**sizes: int) -> Seed:
    return Seed.from_json(record(**sizes))
