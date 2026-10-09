"""Recipe identity is independent of immutable model/encoding compatibility."""
import hashlib
import json
from .config import ROOT


CATALOG_PATH = ROOT / 'packages/computer-player/config/training-recipes-v1.json'
CATALOG = json.loads(CATALOG_PATH.read_text())
BASELINE_ID = 'baseline-v1'


def recipe_binding(recipe_id=BASELINE_ID):
    for item in CATALOG['recipes']:
        if item['id'] == recipe_id:
            digest = hashlib.sha256(json.dumps(item['definition'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            if digest != item['sha256']:
                raise ValueError('training recipe catalog checksum mismatch')
            return {'id': item['id'], 'sha256': digest}
    raise ValueError('unknown training recipe')


def validate_recipe(value):
    if not isinstance(value, dict) or set(value) != {'id', 'sha256'}:
        raise ValueError('invalid training recipe binding')
    expected = recipe_binding(value['id'])
    if value != expected:
        raise ValueError('altered training recipe')
    return expected


def record_recipe(record):
    # Only true absence represents legacy baseline. Explicit null/partial values fail.
    return validate_recipe(record['trainingRecipe']) if 'trainingRecipe' in record else recipe_binding()


def validate_decision_recipe(decision):
    recipe = record_recipe(decision)
    if 'rootExploration' in decision:
        evidence = decision['rootExploration']
        if not isinstance(evidence, dict) or 'trainingRecipe' not in decision or validate_recipe(evidence.get('recipe')) != recipe:
            raise ValueError('exploration recipe provenance mismatch')
    elif recipe['id'] != BASELINE_ID:
        raise ValueError('missing exploration provenance')
    return recipe
