'use strict';

const { traceDbCall, truncateQuery, safeParams } = require('./record');

let patched = false;

/**
 * @param {import('mongoose').Query} query
 */
function describeMongooseQuery(query) {
  const op = query.op || 'query';
  const collection = query.model?.collection?.name || query.mongooseCollection?.name;
  const filter = typeof query.getFilter === 'function' ? query.getFilter() : {};
  const update =
    typeof query.getUpdate === 'function' ? query.getUpdate() : undefined;

  let filterStr = '[unserializable]';
  let updateStr = '';
  try {
    filterStr = JSON.stringify(filter);
  } catch {
    // BSON types or circular refs — fall back to plain text
  }
  if (update) {
    try {
      updateStr = ` update=${JSON.stringify(update)}`;
    } catch {
      updateStr = ' update=[unserializable]';
    }
  }

  let text = `${op} ${filterStr}${updateStr}`;

  return {
    operation: op,
    collection,
    query: truncateQuery(text),
    params: safeParams(filter),
  };
}

function patchMongoose() {
  if (patched) return false;

  let mongoose;

  try {
    const { createRequire } = require('module');
    const path = require('path');
    const hostRequire = createRequire(path.join(process.cwd(), 'package.json'));
    mongoose = hostRequire('mongoose');
  } catch {
    try {
      mongoose = require('mongoose');
    } catch {
      return false;
    }
  }

  if (!mongoose.Query?.prototype?.exec || mongoose.Query.prototype.exec.__openconsWrapped) {
    return false;
  }

  const originalExec = mongoose.Query.prototype.exec;

  mongoose.Query.prototype.exec = function OpenconsMongooseExec(...args) {
    const meta = describeMongooseQuery(this);
    return traceDbCall(() => originalExec.apply(this, args), {
      driver: 'mongoose',
      ...meta,
    });
  };

  mongoose.Query.prototype.exec.__openconsWrapped = true;

  if (mongoose.Aggregate?.prototype?.exec && !mongoose.Aggregate.prototype.exec.__openconsWrapped) {
    const originalAggregateExec = mongoose.Aggregate.prototype.exec;

    mongoose.Aggregate.prototype.exec = function OpenconsAggregateExec(...args) {
      const collection = this._model?.collection?.name;
      const pipeline = this.pipeline();

      return traceDbCall(() => originalAggregateExec.apply(this, args), {
        driver: 'mongoose',
        operation: 'aggregate',
        collection,
        query: truncateQuery(`aggregate ${JSON.stringify(pipeline)}`),
        params: safeParams(pipeline),
      });
    };

    mongoose.Aggregate.prototype.exec.__openconsWrapped = true;
  }

  patched = true;
  return true;
}

module.exports = {
  patchMongoose,
};
