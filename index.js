'use strict'

const path = require('path')

class AdditionalStacksPlugin {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.provider = this.serverless.getProvider('aws')

    // Map CloudFormation status codes to either 'success', 'failure' or 'in_progress'
    this.stackStatusCodes = {
      CREATE_COMPLETE: 'success',
      CREATE_IN_PROGRESS: 'in_progress',
      CREATE_FAILED: 'failure',
      DELETE_COMPLETE: 'success',
      DELETE_FAILED: 'failure',
      DELETE_IN_PROGRESS: 'in_progress',
      REVIEW_IN_PROGRESS: 'in_progress',
      ROLLBACK_COMPLETE: 'failure',
      ROLLBACK_FAILED: 'failure',
      ROLLBACK_IN_PROGRESS: 'in_progress',
      UPDATE_COMPLETE: 'success',
      UPDATE_COMPLETE_CLEANUP_IN_PROGRESS: 'in_progress',
      UPDATE_IN_PROGRESS: 'in_progress',
      UPDATE_ROLLBACK_COMPLETE: 'failure',
      UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS: 'in_progress',
      UPDATE_ROLLBACK_FAILED: 'failure',
      UPDATE_ROLLBACK_IN_PROGRESS: 'in_progress',
    }

    this.phrases = {
      create: {
        success: 'created successfully',
        failure: 'create failed',
      },
      update: {
        success: 'updated successfully',
        failure: 'updated failed',
      },
      delete: {
        success: 'removed successfully',
        failure: 'remove failed',
      },
    }

    this.commands = {
      deploy: {
        commands: {
          additionalstacks: {
            usage: 'Deploy additional stacks',
            lifecycleEvents: [
              'deploy',
            ],
            options: {
              stack: {
                usage: 'Additional stack name to deploy',
                shortcut: 'k',
                required: false,
              },
            },
          },
        },
        options: {
          'skip-additionalstacks': {
            usage: 'Skip deploying additional stacks',
            required: false,
          },
        },
      },
      remove: {
        commands: {
          additionalstacks: {
            usage: 'Remove additional stacks',
            lifecycleEvents: [
              'remove',
            ],
            options: {
              stack: {
                usage: 'Additional stack name to remove',
                shortcut: 'k',
                required: false,
              },
            },
          },
        },
      },
    }

    this.hooks = {
      'before:deploy:deploy': this.beforeDeployGlobal.bind(this),
      'after:deploy:deploy': this.afterDeployGlobal.bind(this),
      'after:info:info': this.afterInfoGlobal.bind(this),
      'deploy:additionalstacks:deploy': this.deployAdditionalStacksDeploy.bind(this),
      'remove:additionalstacks:remove': this.removeAdditionalStacksRemove.bind(this),
    }
  }

  getAdditionalStacks() {
    return this.serverless.service.custom && this.serverless.service.custom.additionalStacks || {}
  }

  getAdditionalBeforeStacks() {
    const beforeStacks = {}
    const stacks = this.getAdditionalStacks()
    Object.keys(stacks).map(stackName => {
      if (!stacks[stackName].Deploy || stacks[stackName].Deploy.toLowerCase() === 'before') {
        beforeStacks[stackName] = stacks[stackName]
      }
    })
    return beforeStacks
  }

  getAdditionalAfterStacks() {
    const afterStacks = {}
    const stacks = this.getAdditionalStacks()
    Object.keys(stacks).map(stackName => {
      if (stacks[stackName].Deploy && stacks[stackName].Deploy.toLowerCase() === 'after') {
        afterStacks[stackName] = stacks[stackName]
      }
    })
    return afterStacks
  }

  // Deploy additional stacks befpre deploying the main stack
  // These are stacks with Deploy: Before, which is the default
  beforeDeployGlobal() {
    if (this.options['skip-additionalstacks'])
      return
    const stacks = this.getAdditionalBeforeStacks()
    if (Object.keys(stacks).length > 0) {
      this.serverless.cli.log('Deploying additional stacks...')
      return this.deployStacks(stacks)
    }
  }

  // Deploy additional stacks after deploying the main stack
  // These are stacks with Deploy: After
  afterDeployGlobal() {
    if (this.options['skip-additionalstacks'])
      return
    const stacks = this.getAdditionalAfterStacks()
    if (Object.keys(stacks).length > 0) {
      this.serverless.cli.log('Deploying additional stacks...')
      return this.deployStacks(stacks)
    }
  }

  // Show additional stack info after normal info
  afterInfoGlobal() {
    if (this.options['skip-additionalstacks'])
      return
    const stacks = this.getAdditionalStacks()
    if (Object.keys(stacks).length > 0) {
      this.serverless.cli.consoleLog('additional stacks:')
      return this.infoStacks(stacks)
    }
  }

  // Deploy additional stacks specified with sls deploy additionalstack [name]
  deployAdditionalStacksDeploy() {
    const stacks = this.getAdditionalStacks()

    if (this.options.stack) {
      const stack = stacks[this.options.stack]
      if (stack) {
        this.serverless.cli.log('Deploying additional stack ' + this.options.stack + '...')
        return this.deployStack(this.options.stack, stack)
      } else {
        return Promise.reject(new Error('Additional stack not found: ' + this.options.stack))
      }
    } else {
      // Deploy all additional stacks
      if (Object.keys(stacks).length > 0) {
        this.serverless.cli.log('Deploying all additional stacks...')
        return this.deployStacks(stacks)
      } else {
        this.serverless.cli.log('No additional stacks defined. Add a custom.additionalStacks section to serverless.yml.')
        return Promise.resolve()
      }
    }
  }

  // Remove additional stacks specified with sls remove additionalstack [name]
  removeAdditionalStacksRemove() {
    const stacks = this.getAdditionalStacks()

    if (this.options.stack) {
      const stack = stacks[this.options.stack]
      if (stack) {
        return this.deleteStack(this.options.stack, stack)
      } else {
        return Promise.reject(new Error('Additional stack not found: ' + this.options.stack))
      }
    } else {
      // Deploy all additional stacks
      if (Object.keys(stacks).length > 0) {
        this.serverless.cli.log('Removing all additional stacks...')
        return this.deleteStacks(stacks)
      } else {
        this.serverless.cli.log('No additional stacks defined. Add a custom.additionalStacks section to serverless.yml.')
        return Promise.resolve()
      }
    }
  }

  // Generate a full name for an additional stack (used in AWS)
  getFullStackName(stackName, stack) {
    const defaultName = this.provider.naming.getStackName() + '-' + stackName
    return stack.StackName || defaultName
  }

  // This deploys all the specified stacks
  deployStacks(stacks) {
    let promise = Promise.resolve()
    Object.keys(stacks).map(stackName => {
      promise = promise
      .then(() => {
        return this.deployStack(stackName, stacks[stackName])
      })
    })
    return promise
  }

  // This is where we actually handle the deployment to AWS
  deployStack(stackName, stack) {
    // Generate the CloudFormation template
    const compiledCloudFormationTemplate = {
      "AWSTemplateFormatVersion": "2010-09-09",
      "Description": stack.Description || "Additional AWS CloudFormation template for this Serverless application",
      "Metadata": stack.Metadata || undefined,
      "Parameters": stack.Parameters || undefined,
      "Mappings": stack.Mappings || undefined,
      "Conditions": stack.Conditions || undefined,
      "Transform": stack.Transform || undefined,
      "Resources": stack.Resources || undefined,
      "Outputs": stack.Outputs || undefined,
    }

    // Generate tags
    const stackTags = {
      STAGE: this.options.stage || this.serverless.service.provider.stage
    }
    if (typeof stack.Tags === 'object') {
      // Add custom tags specified only for this stack
      Object.assign(stackTags, stack.Tags)
    } else if (typeof this.serverless.service.provider.stackTags === 'object') {
      // Add stackTags from Serverless main provider config
      Object.assign(stackTags, this.serverless.service.provider.stackTags)
    }

    // Generate full stack name
    const fullStackName = this.getFullStackName(stackName, stack)

    // Stack deploy parameters (optional)
    const deployParameters = stack.DeployParameters || []

    return this.describeStack(fullStackName)
    .then(stackStatus => {
      if (!stackStatus) {
        // Create stack
        return this.createStack(stackName, fullStackName, compiledCloudFormationTemplate, stackTags, deployParameters)
      } else {
        // Update stack
        return this.updateStack(stackName, fullStackName, compiledCloudFormationTemplate, stackTags, deployParameters)
      }
    })
  }

  // This deletes all the specified stacks
  deleteStacks(stacks) {
    let promise = Promise.resolve()
    Object.keys(stacks).map(stackName => {
      promise = promise
      .then(() => {
        return this.deleteStack(stackName, stacks[stackName])
      })
    })
    return promise
  }

  // This shows the info on all specified stacks
  infoStacks(stacks) {
    let promise = Promise.resolve()
    Object.keys(stacks).map(stackName => {
      promise = promise
      .then(() => {
        return this.infoStack(stackName, stacks[stackName])
      })
    })
    return promise
  }

  describeStack(fullStackName) {
    return this.provider.request(
      'CloudFormation',
      'describeStacks', {
        StackName: fullStackName,
      }
    )
    .then(response => {
      return response.Stacks && response.Stacks[0]
    })
    .then(null, err => {
      if (err.message && err.message.match(/does not exist$/)) {
        // Stack doesn't exist yet
        return null
      } else {
        // Some other error, let it throw
        return Promise.reject(err)
      }
    })
  }

  createStack(stackName, fullStackName, compiledCloudFormationTemplate, stackTags, deployParameters) {
    // These are the same parameters that Serverless uses in https://github.com/serverless/serverless/blob/master/lib/plugins/aws/deploy/lib/createStack.js
    const params = {
      StackName: fullStackName,
      OnFailure: 'ROLLBACK',
      Capabilities: [
        'CAPABILITY_IAM',
        'CAPABILITY_NAMED_IAM',
      ],
      Parameters: deployParameters || [],
      TemplateBody: JSON.stringify(compiledCloudFormationTemplate),
      Tags: Object.keys(stackTags).map((key) => ({ Key: key, Value: stackTags[key] })),
    }

    this.serverless.cli.log('Creating additional stack ' + stackName + '...')
    return this.provider.request(
      'CloudFormation',
      'createStack',
      params
    )
    .then(() => {
      return this.waitForStack(stackName, fullStackName, 'create')
    })
  }

  updateStack(stackName, fullStackName, compiledCloudFormationTemplate, stackTags, deployParameters) {
    // These are the same parameters that Serverless uses in https://github.com/serverless/serverless/blob/master/lib/plugins/aws/lib/updateStack.js
    const params = {
      StackName: fullStackName,
      Capabilities: [
        'CAPABILITY_IAM',
        'CAPABILITY_NAMED_IAM',
      ],
      Parameters: deployParameters || [],
      TemplateBody: JSON.stringify(compiledCloudFormationTemplate),
      Tags: Object.keys(stackTags).map((key) => ({ Key: key, Value: stackTags[key] })),
    }

    return this.provider.request(
      'CloudFormation',
      'updateStack',
      params
    )
    .then(() => {
      this.serverless.cli.log('Updating additional stack ' + stackName + '...')
      return this.waitForStack(stackName, fullStackName, 'update')
    })
    .then(null, err => {
      if (err.message && err.message.match(/^No updates/)) {
        // Stack is unchanged, ignore error
        this.serverless.cli.log('Additional stack ' + stackName + ' has not changed.')
        return Promise.resolve()
      } else {
        return Promise.reject(err)
      }
    })
  }

  // This is where we actually handle the stack deletion from AWS
  deleteStack(stackName, stack) {
    // Generate full stack name
    const fullStackName = this.getFullStackName(stackName, stack)
    this.serverless.cli.log('Removing additional stack ' + stackName + '...')
    return this.provider.request(
      'CloudFormation',
      'deleteStack', {
        StackName: fullStackName,
      }
    )
    .then(() => {
      return this.waitForStack(stackName, fullStackName, 'delete')
    })
  }

  // This is where we actually show information about the CloudFormation stack in AWS
  infoStack(stackName, stack) {
    // Generate full stack name
    const fullStackName = this.getFullStackName(stackName, stack)
    return this.describeStack(fullStackName)
    .then(status => {
      if (!status) {
        this.serverless.cli.consoleLog('  ' + stackName + ': does not exist')
      } else {
        this.serverless.cli.consoleLog('  ' + stackName + ': ' + status.StackStatus)
      }
    })
  }

  waitForStack(stackName, fullStackName, operation) {
    let dots = 0
    const readMore = () => {
      return this.describeStack(fullStackName)
      .then(response => {
        if (!response) {
          // Stack does not exist
          if (dots) this.serverless.cli.consoleLog('')
          this.serverless.cli.log('Additional stack ' + stackName + ' removed successfully.')
          return
        }
        const state = this.stackStatusCodes[response.StackStatus]
        if (state === 'in_progress') {
          // Continue until no longer in progress
          this.serverless.cli.printDot()
          dots += 1
          return new Promise((resolve, reject) => setTimeout(resolve, 5000)).then(readMore)
        } else {
          if (dots) this.serverless.cli.consoleLog('')
          this.serverless.cli.log('Additional stack ' + stackName + ' ' + this.phrases[operation][state] + ' (' + response.StackStatus + ').')
          if (this.stackStatusCodes[response.StackStatus] === 'failure') {
            // The operation failed, so return an error to Serverless
            return Promise.reject(new Error('Additional stack ' + stackName + ' ' + this.phrases[operation][state] + ' (' + response.StackStatus + ')'))
          }
        }
      })
    }
    return readMore()
  }
}

module.exports = AdditionalStacksPlugin
