/* Generated from schemas/. Do not edit. */
export const schemas = {
  "workflow": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:pathsmith:workflow:0.1",
    "title": "Pathsmith workflow 0.1",
    "type": "object",
    "properties": {
      "formatVersion": {
        "const": "0.1"
      },
      "id": {
        "type": "string",
        "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string"
      },
      "bindings": {
        "type": "array",
        "uniqueItems": true,
        "items": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
        }
      },
      "inputSchema": {
        "$ref": "#/$defs/dataSchema"
      },
      "outputSchema": {
        "$ref": "#/$defs/dataSchema"
      },
      "nodes": {
        "type": "array",
        "minItems": 2,
        "maxItems": 100,
        "items": {
          "$ref": "#/$defs/node"
        }
      },
      "edges": {
        "type": "array",
        "minItems": 1,
        "maxItems": 500,
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
            },
            "source": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
            },
            "port": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
            },
            "target": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
            }
          },
          "required": [
            "id",
            "source",
            "port",
            "target"
          ],
          "additionalProperties": false
        }
      }
    },
    "required": [
      "formatVersion",
      "id",
      "name",
      "description",
      "bindings",
      "inputSchema",
      "outputSchema",
      "nodes",
      "edges"
    ],
    "additionalProperties": false,
    "$defs": {
      "jsonValue": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "$ref": "#/$defs/jsonValue"
            }
          },
          {
            "type": "object",
            "additionalProperties": {
              "$ref": "#/$defs/jsonValue"
            }
          }
        ]
      },
      "expr": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "literal"
              },
              "value": {
                "$ref": "#/$defs/jsonValue"
              }
            },
            "required": [
              "op",
              "value"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "ref"
              },
              "path": {
                "type": "array",
                "minItems": 1,
                "items": {
                  "oneOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "integer",
                      "minimum": 0
                    }
                  ]
                }
              }
            },
            "required": [
              "op",
              "path"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "object"
              },
              "fields": {
                "type": "object",
                "additionalProperties": {
                  "$ref": "#/$defs/expr"
                }
              }
            },
            "required": [
              "op",
              "fields"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "array"
              },
              "items": {
                "type": "array",
                "items": {
                  "$ref": "#/$defs/expr"
                }
              }
            },
            "required": [
              "op",
              "items"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "enum": [
                  "eq",
                  "ne",
                  "gt",
                  "gte",
                  "lt",
                  "lte",
                  "add",
                  "sub",
                  "mul",
                  "div",
                  "in"
                ]
              },
              "left": {
                "$ref": "#/$defs/expr"
              },
              "right": {
                "$ref": "#/$defs/expr"
              }
            },
            "required": [
              "op",
              "left",
              "right"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "enum": [
                  "and",
                  "or",
                  "coalesce"
                ]
              },
              "args": {
                "type": "array",
                "minItems": 1,
                "items": {
                  "$ref": "#/$defs/expr"
                }
              }
            },
            "required": [
              "op",
              "args"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "enum": [
                  "not",
                  "exists"
                ]
              },
              "value": {
                "$ref": "#/$defs/expr"
              }
            },
            "required": [
              "op",
              "value"
            ],
            "additionalProperties": false
          }
        ]
      },
      "dataSchema": {
        "type": "object",
        "required": [
          "type"
        ],
        "additionalProperties": false,
        "properties": {
          "type": {
            "enum": [
              "object",
              "array",
              "string",
              "number",
              "integer",
              "boolean",
              "null"
            ]
          },
          "title": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "properties": {
            "type": "object",
            "additionalProperties": {
              "$ref": "#/$defs/dataSchema"
            }
          },
          "required": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "uniqueItems": true
          },
          "additionalProperties": {
            "type": "boolean"
          },
          "items": {
            "$ref": "#/$defs/dataSchema"
          },
          "enum": {
            "type": "array",
            "minItems": 1,
            "items": {
              "$ref": "#/$defs/jsonValue"
            }
          },
          "minimum": {
            "type": "number"
          },
          "maximum": {
            "type": "number"
          },
          "minLength": {
            "type": "integer",
            "minimum": 0
          },
          "maxLength": {
            "type": "integer",
            "minimum": 0
          },
          "minItems": {
            "type": "integer",
            "minimum": 0
          },
          "maxItems": {
            "type": "integer",
            "minimum": 0
          }
        }
      },
      "question": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "choice"
              },
              "instructions": {
                "type": "string",
                "minLength": 1
              },
              "options": {
                "type": "object",
                "minProperties": 2,
                "maxProperties": 255,
                "additionalProperties": {
                  "type": "string",
                  "minLength": 1
                }
              }
            },
            "required": [
              "kind",
              "instructions",
              "options"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "score"
              },
              "instructions": {
                "type": "string",
                "minLength": 1
              },
              "levels": {
                "type": "array",
                "minItems": 2,
                "maxItems": 10,
                "items": {
                  "type": "string",
                  "minLength": 1
                }
              }
            },
            "required": [
              "kind",
              "instructions",
              "levels"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "binary"
              },
              "instructions": {
                "type": "string",
                "minLength": 1
              },
              "trueCriteria": {
                "type": "string",
                "minLength": 1
              },
              "falseCriteria": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "kind",
              "instructions"
            ],
            "additionalProperties": false
          }
        ]
      },
      "node": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
              },
              "kind": {
                "const": "start"
              },
              "label": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "id",
              "kind",
              "label"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
              },
              "kind": {
                "const": "judgment"
              },
              "label": {
                "type": "string",
                "minLength": 1
              },
              "binding": {
                "type": "string",
                "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
              },
              "state": {
                "$ref": "#/$defs/expr"
              },
              "questions": {
                "type": "object",
                "minProperties": 1,
                "maxProperties": 32,
                "propertyNames": {
                  "type": "string",
                  "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
                },
                "additionalProperties": {
                  "$ref": "#/$defs/question"
                }
              }
            },
            "required": [
              "id",
              "kind",
              "label",
              "binding",
              "state",
              "questions"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
              },
              "kind": {
                "const": "transform"
              },
              "label": {
                "type": "string",
                "minLength": 1
              },
              "value": {
                "$ref": "#/$defs/expr"
              }
            },
            "required": [
              "id",
              "kind",
              "label",
              "value"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
              },
              "kind": {
                "const": "branch"
              },
              "label": {
                "type": "string",
                "minLength": 1
              },
              "cases": {
                "type": "array",
                "minItems": 1,
                "items": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string",
                      "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
                    },
                    "when": {
                      "$ref": "#/$defs/expr"
                    }
                  },
                  "required": [
                    "id",
                    "when"
                  ],
                  "additionalProperties": false
                }
              }
            },
            "required": [
              "id",
              "kind",
              "label",
              "cases"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
              },
              "kind": {
                "const": "output"
              },
              "label": {
                "type": "string",
                "minLength": 1
              },
              "outcomeId": {
                "type": "string",
                "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
              },
              "value": {
                "$ref": "#/$defs/expr"
              }
            },
            "required": [
              "id",
              "kind",
              "label",
              "outcomeId",
              "value"
            ],
            "additionalProperties": false
          }
        ]
      }
    }
  },
  "suite": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:pathsmith:suite:0.1",
    "title": "Pathsmith scenario suite 0.1",
    "type": "object",
    "properties": {
      "formatVersion": {
        "const": "0.1"
      },
      "id": {
        "type": "string",
        "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
      },
      "name": {
        "type": "string"
      },
      "description": {
        "type": "string"
      },
      "scenarios": {
        "type": "array",
        "minItems": 1,
        "maxItems": 1000,
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
            },
            "name": {
              "type": "string"
            },
            "tags": {
              "type": "array",
              "uniqueItems": true,
              "items": {
                "type": "string"
              }
            },
            "input": {
              "$ref": "#/$defs/jsonValue"
            },
            "expected": {
              "type": "object",
              "properties": {
                "allowedOutcomes": {
                  "type": "array",
                  "minItems": 1,
                  "uniqueItems": true,
                  "items": {
                    "type": "string",
                    "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
                  }
                },
                "requiredNodes": {
                  "type": "array",
                  "uniqueItems": true,
                  "items": {
                    "type": "string",
                    "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
                  }
                },
                "forbiddenNodes": {
                  "type": "array",
                  "uniqueItems": true,
                  "items": {
                    "type": "string",
                    "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
                  }
                },
                "assertions": {
                  "type": "array",
                  "items": {
                    "$ref": "#/$defs/expr"
                  }
                }
              },
              "required": [],
              "additionalProperties": false
            }
          },
          "required": [
            "id",
            "name",
            "tags",
            "input"
          ],
          "additionalProperties": false
        }
      }
    },
    "required": [
      "formatVersion",
      "id",
      "name",
      "description",
      "scenarios"
    ],
    "additionalProperties": false,
    "$defs": {
      "jsonValue": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "$ref": "#/$defs/jsonValue"
            }
          },
          {
            "type": "object",
            "additionalProperties": {
              "$ref": "#/$defs/jsonValue"
            }
          }
        ]
      },
      "expr": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "literal"
              },
              "value": {
                "$ref": "#/$defs/jsonValue"
              }
            },
            "required": [
              "op",
              "value"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "ref"
              },
              "path": {
                "type": "array",
                "minItems": 1,
                "items": {
                  "oneOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "integer",
                      "minimum": 0
                    }
                  ]
                }
              }
            },
            "required": [
              "op",
              "path"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "object"
              },
              "fields": {
                "type": "object",
                "additionalProperties": {
                  "$ref": "#/$defs/expr"
                }
              }
            },
            "required": [
              "op",
              "fields"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "const": "array"
              },
              "items": {
                "type": "array",
                "items": {
                  "$ref": "#/$defs/expr"
                }
              }
            },
            "required": [
              "op",
              "items"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "enum": [
                  "eq",
                  "ne",
                  "gt",
                  "gte",
                  "lt",
                  "lte",
                  "add",
                  "sub",
                  "mul",
                  "div",
                  "in"
                ]
              },
              "left": {
                "$ref": "#/$defs/expr"
              },
              "right": {
                "$ref": "#/$defs/expr"
              }
            },
            "required": [
              "op",
              "left",
              "right"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "enum": [
                  "and",
                  "or",
                  "coalesce"
                ]
              },
              "args": {
                "type": "array",
                "minItems": 1,
                "items": {
                  "$ref": "#/$defs/expr"
                }
              }
            },
            "required": [
              "op",
              "args"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "op": {
                "enum": [
                  "not",
                  "exists"
                ]
              },
              "value": {
                "$ref": "#/$defs/expr"
              }
            },
            "required": [
              "op",
              "value"
            ],
            "additionalProperties": false
          }
        ]
      }
    }
  },
  "mock-fixtures": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:pathsmith:mock-fixtures:0.1",
    "title": "Pathsmith exact-request mock fixtures 0.1",
    "type": "object",
    "properties": {
      "formatVersion": {
        "const": "0.1"
      },
      "origin": {
        "const": "synthetic"
      },
      "description": {
        "type": "string"
      },
      "entries": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "scenarioId": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
            },
            "nodeId": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
            },
            "binding": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
            },
            "request": {
              "type": "object",
              "properties": {
                "providerId": {
                  "const": "mock"
                },
                "model": {
                  "const": "mock-v1"
                },
                "state": {
                  "$ref": "#/$defs/jsonValue"
                },
                "questions": {
                  "type": "object",
                  "additionalProperties": {
                    "$ref": "#/$defs/question"
                  }
                }
              },
              "required": [
                "providerId",
                "model",
                "state",
                "questions"
              ],
              "additionalProperties": false
            },
            "response": {
              "type": "object",
              "properties": {
                "model": {
                  "const": "mock-v1"
                },
                "answers": {
                  "type": "object",
                  "additionalProperties": {
                    "$ref": "#/$defs/answer"
                  }
                },
                "usage": {
                  "type": "null"
                }
              },
              "required": [
                "model",
                "answers",
                "usage"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "scenarioId",
            "nodeId",
            "binding",
            "request",
            "response"
          ],
          "additionalProperties": false
        }
      }
    },
    "required": [
      "formatVersion",
      "origin",
      "description",
      "entries"
    ],
    "additionalProperties": false,
    "$defs": {
      "jsonValue": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "$ref": "#/$defs/jsonValue"
            }
          },
          {
            "type": "object",
            "additionalProperties": {
              "$ref": "#/$defs/jsonValue"
            }
          }
        ]
      },
      "question": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "choice"
              },
              "instructions": {
                "type": "string",
                "minLength": 1
              },
              "options": {
                "type": "object",
                "minProperties": 2,
                "maxProperties": 255,
                "additionalProperties": {
                  "type": "string",
                  "minLength": 1
                }
              }
            },
            "required": [
              "kind",
              "instructions",
              "options"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "score"
              },
              "instructions": {
                "type": "string",
                "minLength": 1
              },
              "levels": {
                "type": "array",
                "minItems": 2,
                "maxItems": 10,
                "items": {
                  "type": "string",
                  "minLength": 1
                }
              }
            },
            "required": [
              "kind",
              "instructions",
              "levels"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "binary"
              },
              "instructions": {
                "type": "string",
                "minLength": 1
              },
              "trueCriteria": {
                "type": "string",
                "minLength": 1
              },
              "falseCriteria": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "kind",
              "instructions"
            ],
            "additionalProperties": false
          }
        ]
      },
      "answer": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "choice"
              },
              "value": {
                "type": "string"
              },
              "probabilities": {
                "type": "object",
                "additionalProperties": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1
                }
              },
              "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "kind",
              "value",
              "probabilities",
              "confidence"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "score"
              },
              "value": {
                "type": "number",
                "minimum": 0
              },
              "probabilities": {
                "type": "object",
                "additionalProperties": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1
                }
              },
              "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "kind",
              "value",
              "probabilities",
              "confidence"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "binary"
              },
              "probabilityTrue": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "kind",
              "probabilityTrue"
            ],
            "additionalProperties": false
          }
        ]
      }
    }
  }
} as const;
