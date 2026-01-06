# smolGura Project - Claude Code Instructions

This project runs on a GPU server (zenith.nb.fcuai) with NVIDIA GPUs available.

## Environment

- **Server**: zenith.nb.fcuai (GPU machine)
- **GPU**: NVIDIA GPU available for training and inference
- **Runtime**: Use `bun` for JavaScript/TypeScript, Python for ML tasks

## GPU-Related Commands

### Check GPU Status
```bash
nvidia-smi
```

### Running Training
- Always check GPU availability before starting training tasks
- Use appropriate batch sizes based on available VRAM
- Consider using `screen` or `tmux` for long-running training jobs

### Common Patterns
```bash
# Check GPU memory before training
nvidia-smi --query-gpu=memory.free --format=csv

# Run training with specific GPU
CUDA_VISIBLE_DEVICES=0 python train.py

# Monitor GPU during training
watch -n 1 nvidia-smi
```

## Project Structure

- `smolGura/` - Main AI model project
- `tuna/` - Related project (sibling directory)

## Important Notes

1. **Long-running tasks**: Training may take hours. Create clear checkpoints.
2. **Memory management**: Always free GPU memory after tasks complete.
3. **Testing**: Run inference tests to verify model works before pushing.
4. **Dependencies**: Use `pip` or `uv` for Python packages, `bun` for JS/TS.

## Workflow for AI Tasks

1. **Issue Analysis**: Determine if task requires GPU
2. **Environment Check**: Verify GPU is available
3. **Implementation**: Write code with proper GPU utilization
4. **Testing**: Run tests including inference validation
5. **Cleanup**: Ensure GPU memory is released
